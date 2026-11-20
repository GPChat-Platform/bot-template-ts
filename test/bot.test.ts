import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { conversationKey, poll, Update, verifyWebhookSignature } from '../src/gpchat';
import { createBot, parseCommand } from '../src/bot';
import { loadConfig, ConfigError } from '../src/config';
import { createLogger, Metrics } from '../src/ops';
import { Store } from '../src/store';
import { Dedupe } from '../src/webhook';

const silent = createLogger('test', 'error', () => undefined);

function sign(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

test('signature des webhooks : valide, modifiée, expirée, rotation', () => {
  const body = '{"id":"e1"}';
  assert.equal(verifyWebhookSignature(body, sign(body, 's1'), ['s1']), true);
  assert.equal(verifyWebhookSignature(body + ' ', sign(body, 's1'), ['s1']), false);
  assert.equal(verifyWebhookSignature(body, sign(body, 's1', Math.floor(Date.now() / 1000) - 3600), ['s1']), false);
  assert.equal(verifyWebhookSignature(body, sign(body, 'ancien'), ['nouveau', 'ancien']), true);
  assert.equal(verifyWebhookSignature(body, 'n’importe quoi', ['s1']), false);
  assert.equal(verifyWebhookSignature(body, undefined, ['s1']), false);
});

test('configuration : erreurs groupées et valeurs par défaut', () => {
  assert.throws(() => loadConfig({ GPCHAT_MODE: 'webhook', CONCURRENCY: '0' }), (e: Error) =>
    e instanceof ConfigError && /GPCHAT_API_KEY/.test(e.message) && /GPCHAT_WEBHOOK_SECRET/.test(e.message) && /CONCURRENCY/.test(e.message));
  const c = loadConfig({ GPCHAT_API_KEY: 'k', GPCHAT_WEBHOOK_SECRET: 'a, b' });
  assert.equal(c.mode, 'polling');
  assert.equal(c.concurrency, 16);
  assert.deepEqual(c.webhookSecrets, ['a', 'b']);
});

test('analyse des commandes', () => {
  assert.deepEqual(parseCommand('/echo@mon_bot bonjour  '), { name: 'echo', args: 'bonjour' });
  assert.deepEqual(parseCommand('/PING'), { name: 'ping', args: '' });
  assert.equal(parseCommand('bonjour'), null);
});

function setup() {
  const sent: Array<{ target: unknown; text: string; o?: unknown }> = [];
  const edits: Array<{ msgId: string; content?: string }> = [];
  const client = {
    send: async (target: unknown, text: string, o?: unknown) => { sent.push({ target, text, o }); return {}; },
    editMessage: async (_t: unknown, msgId: string, patch: { content?: string }) => { edits.push({ msgId, content: patch.content }); return {}; },
    sendChatAction: async () => ({}),
  };
  const store = new Store('');
  const bot = createBot({ client, store, config: { adminIds: ['admin'], defaultLang: 'fr' }, log: silent });
  const dm = (text: string, from = 'u1') => bot.handle({ id: Math.random().toString(36), type: 'message.received', data: { from, chatId: from, type: 'text', textMsg: text } });
  return { sent, edits, bot, store, dm };
}

test('commandes : start, echo sans Markdown, langue, admin', async () => {
  const s = setup();
  await s.dm('/start');
  assert.match(s.sent.at(-1)!.text, /Bonjour/);
  await s.dm('/echo **gras**');
  assert.equal((s.sent.at(-1)!.o as { markdown: boolean }).markdown, false);
  await s.dm('/lang en');
  await s.dm('/ping');
  assert.match(s.sent.at(-1)!.text, /Pong!/);
  await s.dm('/stats');
  assert.match(s.sent.at(-1)!.text, /reserved/);
  await s.dm('/stats', 'admin');
  assert.match(s.sent.at(-1)!.text, /utilisateurs/);
  await s.dm('/inconnue');
  assert.match(s.sent.at(-1)!.text, /Unknown|inconnue/);
});

test('groupe : ignoré sans commande ni mention ; bouton compteur modifie le message', async () => {
  const s = setup();
  await s.bot.handle({ id: 'g1', type: 'group_message.received', data: { from: 'u1', groupId: 'G', type: 'text', textMsg: 'salut tout le monde' } });
  assert.equal(s.sent.length, 0);
  await s.bot.handle({ id: 'g2', type: 'group_message.received', data: { from: 'u1', groupId: 'G', type: 'text', textMsg: '/ping' } });
  assert.deepEqual(s.sent.at(-1)!.target, { groupId: 'G' });
  await s.bot.handle({ id: 'c1', type: 'callback.received', data: { from: 'u1', chatId: 'u1', data: 'counter:3', msgId: 'm9' } });
  assert.deepEqual(s.edits.at(-1), { msgId: 'm9', content: '🔢 Compteur : **3**' });
});

test('polling : ordre garanti par conversation, parallélisme entre conversations, acquittement après succès', async () => {
  const batches: Update[][] = [[
    { id: 'a1', type: 'message.received', data: { from: 'A', chatId: 'A' } },
    { id: 'a2', type: 'message.received', data: { from: 'A', chatId: 'A' } },
    { id: 'b1', type: 'message.received', data: { from: 'B', chatId: 'B' } },
  ]];
  const acks: string[] = [];
  const client = {
    getUpdates: async (o: { ack?: string[] }) => { acks.push(...(o.ack || [])); return { updates: batches.shift() || [] }; },
  };
  const order: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const stop = poll(client as never, async (u) => {
    running += 1; maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, u.id === 'a1' ? 60 : 10));
    order.push(u.id);
    running -= 1;
  }, { concurrency: 8, busyPollMs: 20, idleDelayMs: 20, timeout: 0 });
  await new Promise((r) => setTimeout(r, 300));
  stop();
  assert.ok(order.indexOf('a1') < order.indexOf('a2'), 'a2 attend a1 (même conversation)');
  assert.ok(order.indexOf('b1') < order.indexOf('a1'), 'B ne attend pas A');
  assert.equal(maxRunning, 2);
  assert.deepEqual([...acks].sort(), ['a1', 'a2', 'b1']);
  assert.equal(conversationKey({ id: 'x', type: 't', data: { groupId: 'G', from: 'u' } }), 'g:G');
});

test('dédoublonnage borné et métriques Prometheus', () => {
  const d = new Dedupe(2);
  assert.equal(d.firstTime('a'), true);
  assert.equal(d.firstTime('a'), false);
  d.firstTime('b'); d.firstTime('c');
  assert.equal(d.firstTime('a'), true, 'les plus anciens sont oubliés');
  const m = new Metrics();
  m.inc('events_total', { type: 'x', result: 'ok' }, 'Événements');
  m.observe('event_duration_seconds', 0.5, { type: 'x' });
  assert.match(m.render(), /gpchat_bot_events_total\{result="ok",type="x"\} 1/);
  assert.match(m.render(), /gpchat_bot_event_duration_seconds_count\{type="x"\} 1/);
});
