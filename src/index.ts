/**
 * Démarrage : configuration → client → routeur → polling OU webhook → serveur d'exploitation.
 * Arrêt propre sur SIGINT/SIGTERM (fin du polling, écriture des préférences).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { createBot } from './bot';
import { GPChatClient, poll } from './gpchat';
import { createLogger, Metrics, startOpsServer } from './ops';
import { Store } from './store';
import { startWebhookServer } from './webhook';

const version = (JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) { console.error(e.message); process.exit(1); }
  throw e;
}

const log = createLogger('bot', config.logLevel);
const metrics = new Metrics();
metrics.set('info', 1, { version, node: process.version }, 'Version du bot');

const client = new GPChatClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
client.onRequest = (route, status, seconds) => {
  metrics.inc('api_requests_total', { route, status }, 'Appels à l’API GPChat');
  metrics.observe('api_request_duration_seconds', seconds, { route }, 'Durée des appels à l’API GPChat');
};
const store = new Store(config.dataDir);
const bot = createBot({ client, store, config, log });

/** Compte, mesure et journalise chaque événement ; laisse remonter l'erreur (non-acquittement). */
const handle = async (u: Parameters<typeof bot.handle>[0]) => {
  const t0 = process.hrtime.bigint();
  try {
    await bot.handle(u);
    metrics.inc('events_total', { type: u.type, result: 'ok' }, 'Événements traités');
  } catch (e) {
    metrics.inc('events_total', { type: u.type, result: 'error' }, 'Événements traités');
    log.error('échec de traitement', { type: u.type, error: (e as Error).message });
    throw e;
  } finally {
    metrics.observe('event_duration_seconds', Number(process.hrtime.bigint() - t0) / 1e9, { type: u.type }, 'Durée de traitement');
  }
};

let lastPollOk = Date.now();
let stop: () => void = () => undefined;
if (config.mode === 'polling') {
  stop = poll(client, handle, {
    concurrency: config.concurrency,
    onPoll: () => { lastPollOk = Date.now(); },
    onError: (e) => log.warn('polling en erreur', { error: e.message }),
  });
} else {
  const server = startWebhookServer({ port: config.port, secrets: config.webhookSecrets, onEvent: handle, log });
  stop = () => server.close();
}

startOpsServer({
  host: config.opsHost,
  port: config.opsPort,
  metrics,
  log,
  checks: config.mode === 'polling'
    ? { polling: () => (Date.now() - lastPollOk < 90_000 ? true : { ok: false, detail: 'aucun polling réussi depuis 90 s' }) }
    : {},
});
log.info('bot démarré', { version, mode: config.mode, concurrency: config.concurrency });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info('arrêt', { signal: sig });
    stop();
    store.flush();
    process.exit(0);
  });
}
