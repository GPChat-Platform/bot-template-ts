/**
 * Exploitation : journaux JSON (une ligne par événement), métriques Prometheus et serveur
 * /healthz (vivant) · /readyz (opérationnel, 503 sinon) · /metrics.
 */
import { createServer, Server } from 'node:http';
import type { LogLevel } from './config';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = Record<LogLevel, (msg: string, fields?: Record<string, unknown>) => void>;

export function createLogger(service: string, level: LogLevel = 'info', out: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  const log = (lvl: LogLevel) => (msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    out(JSON.stringify({ t: new Date().toISOString(), level: lvl, service, msg, ...fields }));
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

type Series = { type: 'counter' | 'gauge' | 'summary'; help: string; values: Map<string, number | { sum: number; count: number }> };

export class Metrics {
  private series = new Map<string, Series>();
  constructor(private readonly prefix = 'gpchat_bot') {}

  private get(name: string, type: Series['type'], help: string): Series {
    let s = this.series.get(name);
    if (!s) { s = { type, help, values: new Map() }; this.series.set(name, s); }
    return s;
  }

  private static key(labels: Record<string, string> = {}): string {
    return Object.keys(labels).sort().map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, '_')}"`).join(',');
  }

  inc(name: string, labels?: Record<string, string>, help = '') {
    const s = this.get(name, 'counter', help);
    const k = Metrics.key(labels);
    s.values.set(k, ((s.values.get(k) as number) || 0) + 1);
  }

  set(name: string, value: number, labels?: Record<string, string>, help = '') {
    this.get(name, 'gauge', help).values.set(Metrics.key(labels), value);
  }

  observe(name: string, seconds: number, labels?: Record<string, string>, help = '') {
    const s = this.get(name, 'summary', help);
    const k = Metrics.key(labels);
    const cur = (s.values.get(k) as { sum: number; count: number }) || { sum: 0, count: 0 };
    s.values.set(k, { sum: cur.sum + seconds, count: cur.count + 1 });
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, s] of this.series) {
      const full = `${this.prefix}_${name}`;
      if (s.help) lines.push(`# HELP ${full} ${s.help}`);
      lines.push(`# TYPE ${full} ${s.type}`);
      for (const [k, v] of s.values) {
        const sel = k ? `{${k}}` : '';
        if (typeof v === 'object') lines.push(`${full}_sum${sel} ${v.sum}`, `${full}_count${sel} ${v.count}`);
        else lines.push(`${full}${sel} ${v}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

export type ReadinessCheck = () => boolean | { ok: boolean; detail?: string } | Promise<boolean | { ok: boolean; detail?: string }>;

export function startOpsServer(o: { host: string; port: number; metrics: Metrics; checks: Record<string, ReadinessCheck>; log: Logger }): Server {
  const startedAt = Date.now();
  const server = createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/healthz') return json(res, 200, { ok: true });
    if (url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      return res.end(o.metrics.render());
    }
    if (url === '/readyz') {
      const problems: string[] = [];
      for (const [name, check] of Object.entries(o.checks)) {
        try {
          const r = await check();
          const ok = typeof r === 'boolean' ? r : r.ok;
          if (!ok) problems.push(typeof r === 'object' && r.detail ? `${name} : ${r.detail}` : name);
        } catch (e) {
          problems.push(`${name} : ${(e as Error).message}`);
        }
      }
      return json(res, problems.length ? 503 : 200, { ok: !problems.length, problems, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
    }
    return json(res, 404, { error: 'not found' });
  });
  server.listen(o.port, o.host, () => o.log.info("serveur d'exploitation en écoute", { host: o.host, port: o.port, routes: ['/healthz', '/readyz', '/metrics'] }));
  return server;
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
