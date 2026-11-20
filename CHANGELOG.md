# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · versionnage : [SemVer](https://semver.org/lang/fr/)

## [Non publié]

## [1.1.0] — 2026-11-20

### Ajouté
- Commandes adressées en groupe (convention Telegram) : « /commande@nom_du_bot » ne concerne que ce bot. Avec `BOT_USERNAME` renseigné, le bot ignore les commandes adressées à un autre bot (la plateforme ne les lui remet déjà plus).

## [1.0.1] — 2026-11-20

### Corrigé
- Tests compatibles Node 20 (la CI échouait sur le motif `**` de `node --test`).

## [1.0.0] — 2026-11-20

### Ajouté
- Modèle de bot TypeScript : polling parallèle ordonné par conversation ou webhook signé (rotation de secret, dédoublonnage), client API avec nouveaux essais, commandes, boutons, Markdown, FR/EN, préférences persistantes.
- Exploitation : journaux JSON, `/healthz` `/readyz` `/metrics`, configuration validée au démarrage.
- Dockerfile multi-étapes durci, CI (Node 20 et 22), 7 tests sans réseau.
