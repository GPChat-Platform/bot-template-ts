/**
 * Routeur : transforme un événement GPChat (polling ou webhook) en appel de commande ou de bouton.
 * Règles :
 *  - conversation privée : commandes, et texte libre → /help (à remplacer par votre logique) ;
 *  - groupe : uniquement les commandes ou les messages qui MENTIONNENT le bot (jamais toute la conversation) ;
 *  - bouton : `callback.received` avec la donnée du bouton (ici le compteur `counter:<n>`).
 */
import type { Config, Lang } from './config';
import { commands, counterButtons } from './commands';
import { button, SendOptions, Target, Update } from './gpchat';
import { t, TextKey } from './i18n';
import type { Logger } from './ops';
import type { Prefs, Store } from './store';

export type Context = {
  args: string;
  lang: Lang;
  userId: string;
  isGroup: boolean;
  isAdmin: boolean;
  reply: (text: string, o?: SendOptions) => Promise<unknown>;
  typing: () => Promise<unknown>;
  t: (key: TextKey, params?: Record<string, string | number>) => string;
  tIn: (lang: Lang, key: TextKey, params?: Record<string, string | number>) => string;
  prefs: Prefs;
  setPrefs: (patch: Prefs) => Prefs;
  stats: () => { users: number };
  button: typeof button;
};

/** « /echo@mon_bot bonjour » → { name: 'echo', args: 'bonjour' } ; sinon null. */
export function parseCommand(text: string | undefined): { name: string; args: string } | null {
  const m = /^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  return m ? { name: m[1].toLowerCase(), args: (m[2] || '').trim() } : null;
}

/** Ce dont le routeur a besoin du client (permet de le remplacer par un faux client dans les tests). */
export type BotClient = {
  send: (target: Target, text: string, o?: SendOptions) => Promise<unknown>;
  editMessage: (target: Target, msgId: string, patch: { content?: string; buttons?: ReturnType<typeof counterButtons> | null }) => Promise<unknown>;
  sendChatAction: (to: string, action?: string, seconds?: number) => Promise<unknown>;
};

export function createBot(o: { client: BotClient; store: Store; config: Pick<Config, 'adminIds' | 'defaultLang'>; log: Logger }) {
  const { client, store, config, log } = o;
  const langOf = (userId: string): Lang => (store.get(userId).lang as Lang) || config.defaultLang;

  function context(target: Target, userId: string, args: string, isGroup: boolean): Context {
    const lang = langOf(userId);
    return {
      args, lang, userId, isGroup,
      isAdmin: config.adminIds.includes(userId),
      reply: (text, opts = {}) => client.send(target, text, { markdown: true, ...opts }),
      typing: () => ('to' in target ? client.sendChatAction(target.to, 'typing', 3).catch(() => undefined) : Promise.resolve()),
      t: (key, params) => t(lang, key, params),
      tIn: (l, key, params) => t(l, key, params),
      prefs: store.get(userId),
      setPrefs: (patch) => store.set(userId, patch),
      stats: () => ({ users: store.count() }),
      button,
    };
  }

  async function runCommand(ctx: Context, name: string) {
    const cmd = commands[name];
    if (!cmd) return ctx.reply(ctx.t('unknown'));
    if (cmd.adminOnly && !ctx.isAdmin) return ctx.reply(ctx.t('adminOnly'));
    return cmd.run(ctx);
  }

  /** Point d'entrée unique. Une exception = événement non acquitté (relivré plus tard). */
  async function handle(u: Update): Promise<void> {
    const d = u.data || {};
    const userId = d.from;
    if (!userId) return;
    if (u.type === 'message.received') {
      if (d.type && d.type !== 'text') return;
      const target: Target = { to: d.chatId || userId };
      const cmd = parseCommand(d.textMsg);
      await runCommand(context(target, userId, cmd ? cmd.args : '', false), cmd ? cmd.name : 'help');
    } else if (u.type === 'group_message.received') {
      if (d.type && d.type !== 'text' || !d.groupId) return;
      const cmd = parseCommand(d.textMsg);
      if (!cmd && !d.isMentioned) return; // le bot n'écoute pas les conversations de groupe
      await runCommand(context({ groupId: d.groupId }, userId, cmd ? cmd.args : '', true), cmd ? cmd.name : 'help');
    } else if (u.type === 'callback.received') {
      const target: Target = d.groupId ? { groupId: d.groupId } : { to: d.chatId || userId };
      const m = /^counter:(-?\d+)$/.exec(String(d.data || ''));
      if (!m) return;
      const n = Math.max(-999, Math.min(999, Number(m[1])));
      const text = t(langOf(userId), 'counter', { n });
      if (d.msgId) await client.editMessage(target, d.msgId, { content: text, buttons: counterButtons(n) });
      else await client.send(target, text, { markdown: true, buttons: counterButtons(n) });
    } else {
      log.debug('événement ignoré', { type: u.type });
    }
  }

  return { handle };
}
