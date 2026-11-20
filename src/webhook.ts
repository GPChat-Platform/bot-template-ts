/**
 * Mode webhook : GPChat appelle votre serveur HTTPS (derrière un reverse proxy) à chaque événement.
 *  - signature vérifiée sur le corps BRUT (X-GPChat-Signature), sinon 401 ;
 *  - réponse 200 immédiate, traitement ensuite (GPChat attend au plus quelques secondes) ;
 *  - un même événement peut être relivré (réseau, nouvel essai) : dédoublonnage par identifiant.
 */
import { createServer, Server } from 'node:http';
import { Update, verifyWebhookSignature } from './gpchat';
import type { Logger } from './ops';

const MAX_BODY = 1024 * 1024;

/** Mémoire bornée des identifiants déjà traités (les plus anciens sont oubliés). */
export class Dedupe {
  private seen = new Set<string>();
  constructor(private readonly max = 5000) {}
  firstTime(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > this.max) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }
}

export function startWebhookServer(o: { port: number; secrets: string[]; onEvent: (u: Update) => Promise<void>; log: Logger; onReceived?: () => void }): Server {
  const dedupe = new Dedupe();
  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') return reply(405, { error: 'POST only' });
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reply(413, { error: 'too large' }); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      const raw = Buffer.concat(chunks);
      if (!verifyWebhookSignature(raw, req.headers['x-gpchat-signature'] as string | undefined, o.secrets)) {
        o.log.warn('signature de webhook invalide');
        return reply(401, { error: 'invalid signature' });
      }
      let event: Update;
      try { event = JSON.parse(raw.toString('utf8')); } catch { return reply(400, { error: 'invalid json' }); }
      reply(200, { ok: true });
      o.onReceived?.();
      if (event.id && !dedupe.firstTime(event.id)) return;
      o.onEvent(event).catch((e: Error) => o.log.error('webhook : échec de traitement', { error: e.message }));
    });
  });
  server.listen(o.port, () => o.log.info('webhook en écoute', { port: o.port }));
  return server;
}
