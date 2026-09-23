---
title: Fpixel
emoji: 🔫
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
pinned: false
short_description: FPS pixel multijoueur pour jouer entre potes
---

# FPIXEL

Petit FPS low-poly en ligne, pensé pour ~10 joueurs, sur PC (clavier/souris) et mobile (tactile).

**Modes** : 1v1 (10 frags) · Match à mort par équipe (Rouge/Bleu, 30 frags) · Chacun pour soi (20 frags) · **Gun Game**
(une arme par niveau : fusil d'assaut → pompe → revolver → sniper → couteau ; un frag = niveau suivant, tuer au dernier niveau = victoire ;
le couteau reste toujours utilisable : un frag au couteau te fait monter d'un niveau **et** fait descendre ta victime)

**Options du salon** (choisies par celui qui crée le salon) : objectif en frags, nombre de joueurs visés (humains + bots), difficulté des bots (facile / normal / difficile).
Les salons automatiques ne sont partagés qu'entre joueurs ayant les mêmes options.

**Reconnexion automatique** : si la connexion saute (Wi-Fi, redémarrage du Space, portable en veille), le jeu se reconnecte tout seul et te rend ta place
(score, équipe, niveau) tant que tu reviens dans les 20 s ; après un redémarrage complet du serveur tu rejoins un nouveau salon.
**Armes** (touches 1-5 ou molette) : fusil d'assaut, fusil à pompe, sniper (clic droit = zoom), revolver, couteau (dans le dos = mort instantanée)

**Bots** : le serveur complète les parties (1v1 : 1 bot en solo · équipes : 4v4 · chacun pour soi : 6 joueurs). Ils cèdent leur place dès qu'un humain arrive
et jouent avec les mêmes règles (mêmes armes, mêmes dégâts, murs qui bloquent). Case « Compléter avec des bots » dans le menu pour les désactiver.

**Mini-carte** (haut-gauche, touche **M** pour la cacher) : toute l'arène vue de dessus, avec tes **coéquipiers** toujours visibles et un **anneau coloré** à l'endroit où quelqu'un vient de tirer (2 s).
Les ennemis qui ne tirent pas restent invisibles : ce n'est pas un wallhack.

**Contrôles PC** : ZQSD/WASD bouger · souris viser · clic gauche **ou F / Entrée** tirer (maintenu = tir en continu) · clic droit zoom sniper · Espace sauter · R recharger · Tab scores.
**Portable sans souris** : le pavé tactile ignore les clics tant qu'une touche est enfoncée (« désactiver pendant la frappe ») → viser avec les **flèches**, tirer avec **F**, ou le **tir automatique** (activé par défaut, réglable) qui tire tout seul quand un ennemi est dans le viseur.

## Architecture

| Partie | Où | Rôle |
|---|---|---|
| `web/` | **Vercel** (fichiers statiques) | client three.js, aucun build |
| `server/` | **Space Hugging Face** (Docker, port 7860) | WebSocket : salons, tirs validés côté serveur, scores |
| `web/shared/` | les deux | armes, modes, carte : une seule source de vérité |

Vercel ne gère pas les WebSockets, d'où le petit serveur sur le Space. Le client détecte tout seul où il tourne :
sur Vercel il parle à `https://benji4565-fpixel.hf.space`, sur le Space ou en local il parle à sa propre origine.
Le serveur sert aussi le client : `https://benji4565-fpixel.hf.space` est jouable directement.

> Jouer depuis l'onglet « App » de la page huggingface.co bloque souvent la souris (iframe) : utiliser le lien direct `*.hf.space` ou Vercel.
> Un Space gratuit s'endort après un moment sans visite : le menu le réveille tout seul (compter ~30 s).

## Lancer en local

```bash
npm install
npm run dev          # http://localhost:7860 (serveur + client)
node test/smoke.mjs  # bots WebSocket : duel, mur, headshot, équipes, fin de manche, IA des bots, options, reconnexion, Gun Game
node test/physics.mjs
node test/security.mjs  # messages piégés, fuzz, limites de connexions, tir à travers un mur
npm test             # les trois suites d'un coup
```

## Déployer

- **Space HF** : `git push` sur le remote `origin` (le Space se reconstruit tout seul).
- **Vercel** : le projet pointe sur le dépôt GitHub (`vercel.json` : dossier `web`, pas de build).

## Réglages de jeu

Tout est dans `web/shared/config.js` (dégâts, cadence, limite de frags, vitesse…) et `web/shared/map.js` (la carte).
`KILL_LIMIT=2 npm run dev` force une limite de frags pour tester les fins de manche ; `RESPAWN_MS`, `PROTECT_MS`, `GRACE_MS` raccourcissent les délais pour les tests.

## Comment ça marche (netcode)

- Le client déplace son joueur (pas de latence à la souris) et envoie sa position 20×/s.
- Les tirs sont envoyés avec une graine aléatoire : le **serveur** refait le tir (mêmes plombs), le teste contre les murs et contre les joueurs
  **rembobinés** à l'instant vu par le tireur (compensation de lag), puis applique les dégâts. Un client modifié ne peut donc pas s'octroyer de faux dégâts.
- Les autres joueurs sont affichés 100 ms « dans le passé » et interpolés.
- La graine de dispersion est imposée par le serveur (nonce envoyé au `welcome` + compteur de tirs) : le client la connaît pour dessiner
  les mêmes plombs, mais ne peut plus choisir celle qui donne une dispersion nulle.
- L'origine du tir doit être visible depuis les yeux du joueur (pas de tir « à travers » un mur en décalant l'origine).
- Déplacements : le client calcule encore son mouvement, mais le serveur tient un budget de distance (vitesse max + marge,
  ~0,8 s d'avance). Téléportation et speedhack sont refusés et le client est recalé (`fix`). `MOVE_CHECK=0` le désactive (tests).
- **Limite connue** : pas encore de collision serveur (noclip possible) ni de munitions comptées côté serveur. Voir `ROADMAP.md`.

## Limites anti-abus (variables d'environnement)

`MAX_CONN` (200 connexions), `MAX_PER_IP` (8, via `X-Forwarded-For` derrière le proxy HF), `MAX_ROOMS` (40 salons).
Un message qui plante est journalisé sans faire tomber le serveur ; une erreur dans un salon ferme ce salon seulement.

## Feuille de route

Synthèse complète du projet et plan pour monter en gamme : [`ROADMAP.md`](ROADMAP.md).
