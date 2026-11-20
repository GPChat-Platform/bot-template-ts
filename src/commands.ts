/**
 * LES COMMANDES DU BOT — c'est ici que vous écrivez votre bot.
 *
 * Chaque entrée : nom → { description: { fr, en }, adminOnly?, run(ctx) }.
 * `ctx` (voir bot.ts) fournit : args, lang, userId, isGroup, isAdmin, reply(), typing(), t(), prefs, setPrefs(), button.
 * Les descriptions alimentent /help et la liste à déclarer dans la console (npm run commands).
 */
import type { Context } from './bot';
import { button } from './gpchat';

export type Command = {
  description: { fr: string; en: string };
  adminOnly?: boolean;
  run: (ctx: Context) => Promise<unknown>;
};

export const counterButtons = (n: number) => [[button.callback('➖', `counter:${n - 1}`), button.callback('➕', `counter:${n + 1}`)]];

export const commands: Record<string, Command> = {
  start: {
    description: { fr: 'Démarrer le bot', en: 'Start the bot' },
    run: (ctx) => ctx.reply(ctx.t('welcome'), {
      buttons: [[button.callback('🔢 Compteur / Counter', 'counter:0'), button.link(ctx.t('docs'), 'https://gpchat.app/developers/docs.html')]],
    }),
  },

  help: {
    description: { fr: 'Liste des commandes', en: 'List the commands' },
    run: (ctx) => {
      const lines = Object.entries(commands)
        .filter(([, c]) => !c.adminOnly || ctx.isAdmin)
        .map(([name, c]) => `• \`/${name}\` — ${c.description[ctx.lang]}`);
      return ctx.reply(`${ctx.t('help')}\n${lines.join('\n')}`);
    },
  },

  ping: {
    description: { fr: 'Vérifier que le bot répond', en: 'Check that the bot answers' },
    run: (ctx) => ctx.reply(ctx.t('pong')),
  },

  echo: {
    description: { fr: 'Répète votre texte : /echo bonjour', en: 'Repeats your text: /echo hello' },
    // Texte venant d'un utilisateur : renvoyé SANS Markdown (il ne doit pas pouvoir mettre en forme ma réponse).
    run: (ctx) => (ctx.args ? ctx.reply(`${ctx.t('echo')} ${ctx.args}`, { markdown: false }) : ctx.reply(ctx.t('echoUsage'))),
  },

  counter: {
    description: { fr: 'Démo de boutons : un compteur modifiable', en: 'Buttons demo: an editable counter' },
    run: (ctx) => ctx.reply(ctx.t('counter', { n: 0 }), { buttons: counterButtons(0) }),
  },

  lang: {
    description: { fr: 'Changer de langue : /lang fr ou en', en: 'Change language: /lang fr or en' },
    run: (ctx) => {
      const v = ctx.args.toLowerCase();
      if (v !== 'fr' && v !== 'en') return ctx.reply(ctx.t('langBad'));
      ctx.setPrefs({ lang: v });
      return ctx.reply(ctx.tIn(v, 'langSet'));
    },
  },

  whoami: {
    description: { fr: 'Afficher votre identifiant GPChat', en: 'Show your GPChat id' },
    run: (ctx) => ctx.reply(ctx.t('whoami', { id: ctx.userId })),
  },

  stats: {
    description: { fr: 'Statistiques du bot (admin)', en: 'Bot statistics (admin)' },
    adminOnly: true,
    run: (ctx) => ctx.reply(`📊 ${ctx.stats().users} utilisateurs`),
  },
};
