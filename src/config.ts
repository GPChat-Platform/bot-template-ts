/**
 * Configuration lue depuis l'environnement, validée au démarrage (toutes les erreurs d'un coup).
 *
 *   GPCHAT_API_KEY         (obligatoire) clé API du bot — console développeur → Identifiants
 *   GPCHAT_MODE            polling (défaut) | webhook
 *   GPCHAT_WEBHOOK_SECRET  (webhook) secret(s) de signature, séparés par des virgules pendant une rotation
 *   PORT                   port du webhook (8080)
 *   CONCURRENCY            conversations traitées en parallèle en polling (16)
 *   DATA_DIR               dossier des préférences (./data) ; vide = mémoire seulement
 *   ADMIN_IDS              userId des administrateurs, séparés par des virgules
 *   DEFAULT_LANG           fr (défaut) | en
 *   LOG_LEVEL              debug | info (défaut) | warn | error
 *   OPS_PORT / OPS_HOST    serveur d'exploitation /healthz /readyz /metrics (9100 / 127.0.0.1)
 *   GPCHAT_BASE_URL        autre environnement (rare)
 */
export type Lang = 'fr' | 'en';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Config = {
  apiKey: string;
  mode: 'polling' | 'webhook';
  webhookSecrets: string[];
  port: number;
  concurrency: number;
  dataDir: string;
  adminIds: string[];
  defaultLang: Lang;
  logLevel: LogLevel;
  opsPort: number;
  opsHost: string;
  baseUrl?: string;
};

const list = (v: string | undefined) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function int(name: string, raw: string | undefined, def: number, min: number, max: number, errors: string[]): number {
  const n = raw == null || raw === '' ? def : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) errors.push(`${name} doit être un entier entre ${min} et ${max} (reçu : « ${raw} »)`);
  return n;
}

export class ConfigError extends Error {
  constructor(errors: string[]) {
    super(`Configuration invalide :\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const errors: string[] = [];
  const mode = (env.GPCHAT_MODE || 'polling').toLowerCase();
  if (mode !== 'polling' && mode !== 'webhook') errors.push(`GPCHAT_MODE doit valoir polling ou webhook (reçu : « ${env.GPCHAT_MODE} »)`);
  if (!env.GPCHAT_API_KEY) errors.push('GPCHAT_API_KEY est obligatoire (console développeur → Identifiants)');
  const webhookSecrets = list(env.GPCHAT_WEBHOOK_SECRET);
  if (mode === 'webhook' && !webhookSecrets.length) errors.push('GPCHAT_WEBHOOK_SECRET est obligatoire en mode webhook');
  const lang = (env.DEFAULT_LANG || 'fr').toLowerCase();
  if (lang !== 'fr' && lang !== 'en') errors.push('DEFAULT_LANG doit valoir fr ou en');
  const level = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(level)) errors.push('LOG_LEVEL doit valoir debug, info, warn ou error');
  const cfg: Config = {
    apiKey: env.GPCHAT_API_KEY || '',
    mode: mode as Config['mode'],
    webhookSecrets,
    port: int('PORT', env.PORT, 8080, 1, 65535, errors),
    concurrency: int('CONCURRENCY', env.CONCURRENCY, 16, 1, 256, errors),
    dataDir: env.DATA_DIR === undefined ? './data' : env.DATA_DIR,
    adminIds: list(env.ADMIN_IDS),
    defaultLang: lang as Lang,
    logLevel: level as LogLevel,
    opsPort: int('OPS_PORT', env.OPS_PORT, 9100, 1, 65535, errors),
    opsHost: env.OPS_HOST || '127.0.0.1',
    baseUrl: env.GPCHAT_BASE_URL || undefined,
  };
  if (errors.length) throw new ConfigError(errors);
  return cfg;
}
