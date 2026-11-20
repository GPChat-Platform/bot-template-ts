# Modèle de bot GPChat — TypeScript

Point de départ **prêt pour la production** pour un bot [GPChat](https://gpchat.app) en TypeScript (Node.js ≥ 20, aucune dépendance d'exécution).
Cliquez sur **« Use this template »**, renseignez votre clé API, lancez : votre bot répond.

> Autres langages : [JavaScript](https://github.com/GPChat-Platform/bot-template) · **TypeScript** · [Python](https://github.com/GPChat-Platform/bot-template-python) · [Go](https://github.com/GPChat-Platform/bot-template-go) · [Java (Quarkus)](https://github.com/GPChat-Platform/bot-template-quarkus) — même architecture, mêmes commandes, même comportement.

## Ce que vous obtenez
- **Polling** (aucun serveur public) ou **webhook** signé (HMAC-SHA256, rotation de secret, dédoublonnage).
- **Polling parallèle** : jusqu'à `CONCURRENCY` conversations à la fois, toujours dans l'ordre au sein d'une conversation ; un événement n'est acquitté que s'il a été traité.
- Client API avec **nouveaux essais** (429/5xx, `Retry-After`) et délais maximaux.
- Registre de **commandes** (`/start`, `/help`, `/ping`, `/echo`, `/counter` avec boutons, `/lang`, `/whoami`, `/stats` admin), **Markdown**, **boutons**, **français / anglais**, préférences persistantes.
- **Groupes** : le bot ne répond qu'aux commandes et aux mentions.
- **Exploitation** : journaux JSON, `/healthz`, `/readyz`, `/metrics` (Prometheus), version exposée.
- Configuration **validée au démarrage**, Dockerfile durci (`HEALTHCHECK`, utilisateur non root), CI GitHub Actions, tests sans réseau.

## Démarrer en 3 minutes
1. Créez le bot : console développeur (https://gpchat.app/developers/console) ou `@gpchat_forge` → `/newbot`, puis copiez la clé API.
2. Dans l'onglet *Webhooks* de la console, choisissez le mode **polling** (ou `/setmode polling` dans `@gpchat_forge`).
3. Lancez :
```bash
cp .env.example .env        # renseignez GPCHAT_API_KEY
npm install
npm run dev                  # compile puis démarre avec .env
```
Écrivez `/start` à votre bot dans GPChat.

## Écrire votre bot
Tout se passe dans **`src/commands.ts`** : ajoutez une entrée `nom: { description: { fr, en }, run: async (ctx) => … }`.
`ctx` fournit `args`, `lang`, `userId`, `isGroup`, `isAdmin`, `reply(texte, { markdown, buttons })`, `typing()`, `t(clé)`, `prefs` / `setPrefs()`, `button.callback()` / `button.link()`.
Les textes sont dans `src/i18n.ts`. Les boutons d'action arrivent dans `src/bot.ts` (`callback.received`).
`npm run commands` affiche la liste des commandes à déclarer dans la console (menu `/` de l'app).

| Fichier | Rôle |
|---|---|
| `src/commands.ts` | **vos commandes** |
| `src/bot.ts` | routeur : messages privés, groupes (commandes et mentions), boutons |
| `src/gpchat.ts` | client API, polling parallèle ordonné, vérification de signature |
| `src/webhook.ts` | serveur webhook (signature, 200 immédiat, dédoublonnage) |
| `src/config.ts` | variables d'environnement validées |
| `src/ops.ts` | journaux JSON, métriques, `/healthz` `/readyz` `/metrics` |
| `src/store.ts` | préférences (fichier JSON atomique) |

## Configuration
| Variable | Défaut | Rôle |
|---|---|---|
| `GPCHAT_API_KEY` | — | clé API du bot (**obligatoire**) |
| `GPCHAT_MODE` | `polling` | `polling` ou `webhook` |
| `GPCHAT_WEBHOOK_SECRET` | — | secret(s) de signature, séparés par des virgules pendant une rotation |
| `PORT` | `8080` | port du webhook |
| `CONCURRENCY` | `16` | conversations traitées en parallèle (polling) |
| `DATA_DIR` | `./data` | préférences ; vide = mémoire seulement |
| `ADMIN_IDS` | — | userId des administrateurs (`/whoami` affiche le vôtre) |
| `DEFAULT_LANG` | `fr` | `fr` ou `en` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `OPS_PORT` / `OPS_HOST` | `9100` / `127.0.0.1` | serveur d'exploitation (jamais exposé sur Internet) |

## Production
```bash
docker build -t mon-bot .
docker run -d --restart unless-stopped --env-file .env -v mon-bot-data:/data -p 127.0.0.1:9100:9100 mon-bot
```
- Webhook : mettez le bot derrière un reverse proxy HTTPS, déclarez l'URL dans la console et testez-la (bouton *Tester*).
- Alertes : renseignez un e-mail ou un webhook d'alerte dans la console — GPChat vous prévient si votre bot ne vient plus chercher ses messages ou si votre webhook tombe.
- État de la plateforme : https://gpchat.app/status (JSON : `GET https://api.gpchat.app/v1/status`).

## Tests
```bash
npm test        # compilation + tests (signature, configuration, commandes, groupes, boutons, polling ordonné)
```

---

## English
Production-ready **TypeScript** starter for a GPChat bot: polling or signed webhook, ordered parallel polling, retries, commands, buttons, FR/EN, JSON logs, `/healthz` `/readyz` `/metrics`, Docker, CI, tests.
Click **“Use this template”**, copy `.env.example` to `.env`, set `GPCHAT_API_KEY`, then `npm install && npm run dev`. Write your bot in `src/commands.ts`.
Docs: https://gpchat.app/en/developers/docs.html

Licence MIT.
