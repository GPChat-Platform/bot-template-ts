/** Textes du bot (français / anglais). `{x}` = paramètre. Ajoutez vos textes ici. */
import type { Lang } from './config';

const TEXTS = {
  fr: {
    welcome: '👋 **Bonjour !** Je suis un bot modèle GPChat écrit en TypeScript.\n\nTapez /help pour voir ce que je sais faire.',
    help: '📖 **Commandes**',
    pong: '🏓 Pong ! Le bot répond.',
    echo: '🔁',
    echoUsage: 'Exemple : /echo bonjour',
    counter: '🔢 Compteur : **{n}**',
    langSet: '🇫🇷 Langue : français.',
    langBad: 'Langue : /lang fr ou /lang en',
    whoami: '🆔 Votre identifiant GPChat : `{id}`',
    unknown: 'Commande inconnue. Tapez /help.',
    adminOnly: '🔒 Commande réservée aux administrateurs du bot.',
    error: '😕 Un problème est survenu. Réessayez dans un instant.',
    docs: '📚 Documentation',
  },
  en: {
    welcome: '👋 **Hi!** I am a GPChat template bot written in TypeScript.\n\nType /help to see what I can do.',
    help: '📖 **Commands**',
    pong: '🏓 Pong! The bot is answering.',
    echo: '🔁',
    echoUsage: 'Example: /echo hello',
    counter: '🔢 Counter: **{n}**',
    langSet: '🇬🇧 Language: English.',
    langBad: 'Language: /lang fr or /lang en',
    whoami: '🆔 Your GPChat id: `{id}`',
    unknown: 'Unknown command. Type /help.',
    adminOnly: '🔒 This command is reserved for the bot administrators.',
    error: '😕 Something went wrong. Please try again in a moment.',
    docs: '📚 Documentation',
  },
} as const;

export type TextKey = keyof (typeof TEXTS)['fr'];

export function t(lang: Lang, key: TextKey, params: Record<string, string | number> = {}): string {
  const s: string = TEXTS[lang]?.[key] ?? TEXTS.fr[key];
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] == null ? '' : String(params[k])));
}
