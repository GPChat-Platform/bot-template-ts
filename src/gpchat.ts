/**
 * Client minimal de l'API GPChat pour les bots (Node.js ≥ 20, aucune dépendance).
 *
 *   const bot = new GPChatClient({ apiKey });
 *   await bot.sendMessage(userId, 'Bonjour **monde**', { markdown: true });
 *   const stop = poll(bot, handler, { concurrency: 16 });
 *
 * Contrat de l'API : https://gpchat.app/developers/docs.html — référence : https://gpchat.app/developers/api-reference
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_BASE_URL = 'https://api.gpchat.app/v1';

/** Bouton sous un message : action (callbackData, renvoyée au bot) ou lien (url). */
export type Button = { text: string; callbackData?: string; url?: string };
export const button = {
  callback: (text: string, callbackData: string): Button => ({ text, callbackData }),
  link: (text: string, url: string): Button => ({ text, url }),
};

/** Événement reçu (polling ou webhook). Les champs de `data` dépendent du type. */
export type Update = {
  id: string;
  type: 'message.received' | 'group_message.received' | 'callback.received' | string;
  data: {
    from?: string;
    chatId?: string;
    groupId?: string;
    type?: string;
    textMsg?: string;
    isMentioned?: boolean;
    data?: string; // callback : donnée du bouton
    msgId?: string;
    [k: string]: unknown;
  };
};

export type Target = { to: string } | { groupId: string };
export type SendOptions = { markdown?: boolean; buttons?: Button[][]; replyToMsgId?: string };

export class GPChatError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'GPChatError';
  }
}

export class GPChatClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  /** Appelée après chaque requête (métriques). */
  onRequest?: (route: string, status: string, seconds: number) => void;

  constructor(o: { apiKey: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number }) {
    if (!o.apiKey) throw new Error('apiKey requise');
    this.apiKey = o.apiKey;
    this.baseUrl = (o.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.maxRetries = o.maxRetries ?? 2;
  }

  /** Requête avec nouveaux essais (429 et 5xx, en respectant Retry-After) et délai maximal. */
  async request<T = unknown>(path: string, body: unknown, o: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
    const retries = o.retries ?? this.maxRetries;
    for (let attempt = 0; ; attempt += 1) {
      const t0 = process.hrtime.bigint();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? this.timeoutMs);
      try {
        const res = await fetch(this.baseUrl + path, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
          signal: ctrl.signal,
        });
        const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; code?: string };
        this.onRequest?.(path, `${String(res.status)[0]}xx`, Number(process.hrtime.bigint() - t0) / 1e9);
        if (res.ok) return (json.data ?? json) as T;
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const after = Number(res.headers.get('retry-after'));
          await sleep(after > 0 ? after * 1000 : 500 * 2 ** attempt);
          continue;
        }
        throw new GPChatError(json.message || `HTTP ${res.status}`, res.status, json.code);
      } catch (e) {
        if (e instanceof GPChatError) throw e;
        this.onRequest?.(path, 'réseau', Number(process.hrtime.bigint() - t0) / 1e9);
        if (attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
        throw new GPChatError((e as Error).name === 'AbortError' ? 'délai dépassé' : (e as Error).message, undefined, 'network');
      } finally {
        clearTimeout(timer);
      }
    }
  }

  sendMessage(to: string, content: string, o: SendOptions = {}) {
    return this.request<{ msgId: string }>('/messages', textBody({ to }, content, o));
  }

  sendGroupMessage(groupId: string, content: string, o: SendOptions = {}) {
    return this.request<{ msgId: string }>('/messages/group', textBody({ groupId }, content, o));
  }

  /** Répond dans la conversation d'origine (privée ou groupe). */
  send(target: Target, content: string, o: SendOptions = {}) {
    return 'groupId' in target ? this.sendGroupMessage(target.groupId, content, o) : this.sendMessage(target.to, content, o);
  }

  editMessage(target: Target, msgId: string, patch: { content?: string; buttons?: Button[][] | null }) {
    return this.request('/messages/edit', { ...target, msgId, ...patch });
  }

  /** « écrit… » (cosmétique) : aucun nouvel essai, pour ne pas consommer le quota sous forte charge. */
  sendChatAction(to: string, action = 'typing', seconds = 5) {
    return this.request('/chat/action', { to, action, seconds }, { timeoutMs: (seconds + 30) * 1000, retries: 0 });
  }

  getUpdates(o: { ack?: string[]; limit?: number; timeout?: number }) {
    return this.request<{ updates: Update[]; hasMore?: boolean }>('/updates', o, { timeoutMs: ((o.timeout ?? 0) + 30) * 1000 });
  }
}

function textBody(base: Target, content: string, o: SendOptions) {
  return { ...base, type: 'text', content, parseMode: o.markdown ? 'markdown' : undefined, buttons: o.buttons, replyToMsgId: o.replyToMsgId };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Vérifie l'en-tête `X-GPChat-Signature` (`t=<secondes>,v1=<hex>[,v1=<hex>]`) sur le corps BRUT.
 * Signature = HMAC-SHA256(secret, `${t}.${corps}`). Plusieurs `v1` pendant une rotation de secret ;
 * plusieurs secrets acceptés côté bot pour la même raison. Tolérance d'horloge : 300 s.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined, secrets: string[], nowMs = Date.now(), toleranceSeconds = 300): boolean {
  const m = /^t=(\d+)((?:,v1=[0-9a-f]{64})+)$/.exec(header || '');
  if (!m) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(m[1])) > toleranceSeconds) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const provided = m[2].split(',').filter(Boolean).map((p) => Buffer.from(p.slice(3), 'hex'));
  return secrets.some((s) => {
    const expected = createHmac('sha256', s).update(`${m[1]}.${body}`, 'utf8').digest();
    return provided.some((p) => p.length === expected.length && timingSafeEqual(p, expected));
  });
}

/** Clé de conversation : l'ordre des messages est garanti à l'intérieur d'une même conversation. */
export function conversationKey(u: Update): string {
  const d = u.data || {};
  if (d.groupId) return `g:${d.groupId}`;
  if (d.chatId) return `c:${d.chatId}`;
  if (d.from) return `u:${d.from}`;
  return `e:${u.id}`;
}

/**
 * Boucle de polling. `handler` est appelé pour chaque événement, jusqu'à `concurrency` conversations
 * en parallèle mais toujours dans l'ordre au sein d'une conversation. Un événement n'est acquitté
 * que si `handler` réussit (sinon il est relivré, au plus tôt après `retryAfterMs`).
 * Retourne une fonction d'arrêt.
 */
export function poll(
  client: Pick<GPChatClient, 'getUpdates'>,
  handler: (u: Update) => Promise<void>,
  o: { timeout?: number; limit?: number; concurrency?: number; busyPollMs?: number; idleDelayMs?: number; retryAfterMs?: number; onError?: (e: Error) => void; onPoll?: () => void } = {},
): () => void {
  const { timeout = 20, limit = 50, concurrency = 16, busyPollMs = 1100, idleDelayMs = 1000, retryAfterMs = 30_000 } = o;
  const onError = o.onError ?? ((e: Error) => console.error('[gpchat] polling :', e.message));
  let stopped = false;
  const toAck: string[] = [];
  const inFlight = new Set<string>();
  const done = new Map<string, number>();
  const failed = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = () => (active < concurrency ? (active += 1, Promise.resolve()) : new Promise<void>((r) => waiters.push(r)));
  const release = () => { const next = waiters.shift(); if (next) next(); else active -= 1; };

  const schedule = (u: Update) => {
    inFlight.add(u.id);
    const key = conversationKey(u);
    const run = (chains.get(key) || Promise.resolve()).then(async () => {
      await acquire();
      try {
        await handler(u);
        toAck.push(u.id);
        done.set(u.id, Date.now());
      } catch (e) {
        failed.set(u.id, Date.now());
        onError(e as Error);
      } finally {
        release();
        inFlight.delete(u.id);
      }
    });
    chains.set(key, run);
    void run.then(() => { if (chains.get(key) === run) chains.delete(key); });
  };

  void (async () => {
    while (!stopped) {
      try {
        const busy = inFlight.size > 0;
        const { updates = [] } = await client.getUpdates({ ack: toAck.splice(0), limit, timeout: busy ? 0 : timeout });
        o.onPoll?.();
        let fresh = 0;
        for (const u of updates) {
          if (inFlight.has(u.id)) continue;
          if (done.has(u.id)) { toAck.push(u.id); continue; }
          if (Date.now() - (failed.get(u.id) || 0) < retryAfterMs) continue;
          schedule(u);
          fresh += 1;
        }
        const cutoff = Date.now() - 5 * 60_000;
        for (const [id, at] of done) if (at < cutoff) done.delete(id);
        for (const [id, at] of failed) if (at < cutoff) failed.delete(id);
        if (fresh === 0 && (inFlight.size > 0 || updates.length > 0)) await sleep(busyPollMs);
        else if (updates.length === 0 && timeout === 0) await sleep(idleDelayMs); // pas d'attente côté serveur : on patiente ici
      } catch (e) {
        onError(e as Error);
        await sleep(3000);
      }
    }
  })();
  return () => { stopped = true; };
}
