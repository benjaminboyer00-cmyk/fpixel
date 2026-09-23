# FPIXEL, synthèse du projet et chemin vers un niveau Krunker

## 1. Où en est le jeu

FPIXEL est un FPS multijoueur dans le navigateur, en low-poly pixelisé, pensé pour jouer entre potes. Le client est statique (Vercel) et le serveur est un process Node avec une seule dépendance (`ws`) qui tourne sur un Space Hugging Face gratuit. Il n'y a ni build ni framework, three.js est vendorisé, et tout le code partagé (armes, cartes, physique de l'avion) vit dans `web/shared/` pour que le client et le serveur calculent exactement la même chose.

Le contenu est déjà large pour un projet solo. Il y a cinq modes (chacun pour soi, équipes, duel, Gun Game, Survie en coop avec boutique et manches — le mode Braquage a été retiré), quatre cartes (Arène, Village, Entrepôt, Quartier), sept classes plus une classe Perso à budget de points, une vingtaine d'armes dont plusieurs vraiment originales (portail, grappin, Excalibur et son onde, canon à orbe, avion en papier piloté, missile nucléaire avec gaz), des séries de kills, des bots avec pathfinding et trois niveaux, des monstres, la reconnexion automatique avec jeton et un mode tactile complet.

Le netcode est sain sur le principe. Les tirs sont rejoués côté serveur avec compensation de lag (rembobinage des positions jusqu'à 400 ms), les autres joueurs sont interpolés, et la dispersion est déterministe grâce à une graine imposée par le serveur. Les tests sont sérieux pour un projet perso : une suite physique, un smoke test qui ouvre de vraies connexions WebSocket, et une suite sécurité.

Les faiblesses restantes : le déplacement est encore calculé côté client (le serveur ne fait que brider la vitesse, pas encore de simulation autoritaire complète — voir 3.2), `server/index.js` et `web/js/game.js` sont de gros fichiers qui font tout, et il n'existe rien qui fasse revenir un joueur le lendemain (pas de compte, pas de progression, pas de classement).

## 2. Ce que contient cette version

**Sécurité serveur**

- Le crash en un seul message est corrigé. `{"t":"join","map":"toString"}` (ou `mode`, ou `cls`) faisait tomber tout le serveur, parce que les recherches `MAPS[x]`, `MODES[x]` et `CLASSES[x]` acceptaient les clés héritées d'`Object.prototype`. Toutes passent maintenant par `Object.hasOwn`.
- Chaque message est entouré d'un try/catch, et une erreur dans un salon (dans la boucle de tick aussi) ne ferme que ce salon.
- On ne peut plus tirer à travers les murs. L'origine du tir doit être visible depuis les yeux du joueur, alors qu'avant on pouvait la placer 3 m plus loin, de l'autre côté d'un mur.
- La graine de dispersion est imposée par le serveur (un nonce envoyé au `welcome`, plus un compteur de tirs). Le client ne peut plus choisir la graine qui donne une dispersion nulle.
- La dispersion en visée (ADS) est alignée entre client et serveur, ce qui supprime les « touches fantômes » au fusil d'assaut.
- Les déplacements sont contrôlés. Le serveur tient un budget de distance qui se recharge à la vitesse maximale autorisée. Une téléportation ou un speedhack est refusé, et le client reçoit un message `fix` qui le recale. Le grappin, les explosions et les portails ouvrent une fenêtre plus large, et une coupure réseau de moins d'une seconde passe sans accroc.
- Des limites anti-abus sont en place : 200 connexions au total, 8 par adresse IP, 40 salons, et un client qui dépasse 400 messages par seconde est coupé.
- Les salons de Survie en solo ne sont plus listés publiquement. Leur nom dérivait du jeton de reconnexion, et n'importe qui pouvait les rejoindre. Le serveur sait aussi rejoindre un salon précis par son identifiant (`rid`), en prévision d'un futur navigateur de salons côté client.

**Menu**

Le menu regroupe les modes en 3 catégories (Multijoueur, Survie, Fun) plutôt qu'une liste plate, et le sélecteur de classe est passé de `<select>` à des cartes défilables (PV/vitesse en barres, armes en slots numérotés, fiche d'arme à 4 barres calculée depuis `shared/config.js`, icônes d'armes rendues via un `WebGLRenderer` hors écran à partir des modèles 3D du jeu). Voir le commit qui a introduit ce menu pour le détail ; les idées de navigateur de salons et de lien d'invitation listées en 3.5/3.1 restent à faire côté client.

**Tests**

`npm test` lance trois suites (physique, smoke multijoueur, sécurité), toutes vertes.

## 3. Ce qui sépare FPIXEL de Krunker

Krunker n'est pas meilleur parce qu'il a plus d'armes. Il l'est parce que chaque seconde de jeu est nerveuse, parce que le jeu est juste (le serveur décide), et parce qu'il y a toujours une raison de relancer une partie. Voici l'écart domaine par domaine.

### 3.1 Sensation de jeu

C'est le plus important et c'est là que Krunker est imbattable. Le mouvement y est une compétence : glissade au sol qui conserve la vitesse, bunny hop avec contrôle aérien, saut accroupi, strafe qui accélère. Chez FPIXEL le mouvement est correct mais plat.

- Ajouter une **glissade** (Maj + C en sprint) avec une impulsion initiale et une décélération lente, plus un léger boost en sortant de pente.
- Ajouter du **contrôle aérien** façon Quake (accélération vers la direction souhaitée plafonnée par projection) pour que le strafe en l'air ait du sens.
- **Coyote time** (100 ms) et **tampon de saut** (100 ms) pour que les sauts répondent toujours.
- **Mouvement de l'arme** (bobbing, balancement sur la souris, recul qui remonte la vue puis revient) et **FOV dynamique** en sprint.
- **Retour de tir** plus fort : son de hitmarker distinct pour la tête, chiffres de dégâts flottants, léger ralenti de l'écran sur un kill, son de kill cumulatif pour les séries.

Tout ça se joue dans `web/js/physics.js` et `game.js`. Comme la physique devra aussi tourner côté serveur (voir 3.2), il faut la déplacer dans `web/shared/` dès maintenant.

### 3.2 Serveur autoritaire

Aujourd'hui le client calcule sa position et le serveur vérifie seulement la vitesse. C'est suffisant contre les tricheurs basiques, mais pas pour un jeu public.

La cible est le modèle classique des FPS compétitifs. Le client envoie ses entrées numérotées (touches, angles, dt) au lieu de sa position. Le serveur simule avec la même physique partagée et renvoie son état avec le numéro de la dernière entrée traitée. Le client prédit localement, puis rejoue les entrées non confirmées depuis l'état serveur (réconciliation). Une fois ce modèle en place, plusieurs trous se ferment d'eux-mêmes : le noclip, l'anti-recul (les impulsions sont appliquées par le serveur), le faux état de visée (le serveur sait si tu vises et depuis quand), et les munitions (le serveur compte).

À faire en même temps : calculer le temps de rembobinage depuis le RTT mesuré plutôt que de prendre la valeur du client, et passer les snapshots en binaire (ArrayBuffer, positions quantifiées sur 16 bits, envoi en delta) dès qu'on vise plus de dix joueurs par salon.

### 3.3 Contenu et lisibilité

- **Cartes** : Krunker vit de cartes compactes avec beaucoup de verticalité et des lignes de vue nettes. Il faudrait deux ou trois nouvelles cartes pensées pour le mouvement (rampes, toits, trous), et à terme un **éditeur de cartes** dans le navigateur. Le format `boxes` actuel s'y prête parfaitement, puisqu'une carte n'est qu'une liste de boîtes.
- **Lisibilité** : un contour de couleur sur les ennemis (rouge) et les alliés (bleu), une silhouette visible au travers des fumées de grenade, et des effets de tir moins chargés sur mobile.
- **Réticule personnalisable** (taille, écart, couleur, point) et **sensibilités par arme**.
- **Killcam** de trois secondes (le serveur a déjà l'historique des positions) et **spectateur** entre deux vies en duel.

### 3.4 Progression et raison de revenir

C'est ce qui manque le plus en dehors du gameplay.

- **Comptes légers** : pseudo plus code secret, ou connexion Google, stockés dans une vraie base. Supabase est le choix naturel, il est déjà connecté à ton environnement.
- **Niveau de joueur et XP** par partie, **défis quotidiens** (« 10 frags au revolver »), **camouflages d'armes** débloqués par l'usage. Les icônes pixel se prêtent très bien aux variantes de couleur.
- **Classement hebdomadaire** et **mode classé** en duel avec un Elo simple.
- **Statistiques de carrière** côté serveur, pour qu'elles ne soient plus perdues quand on vide le navigateur.

### 3.5 Social

Le lien d'invitation et le navigateur de salons sont posés. Les prochaines étapes sont un chat de salon textuel (filtré, avec limite de débit), des parties personnalisées avec paramètres partagés (gravité, vitesse, armes autorisées), une liste d'amis une fois les comptes en place, et un bouton « rejouer avec ce groupe » en fin de partie.

### 3.6 Performance et infrastructure

- Le Space gratuit s'endort, et son réveil prend environ 30 secondes. Pour un jeu public, il faut un petit serveur toujours allumé (Fly.io, Railway ou une VM à quelques euros) et, à terme, plusieurs régions avec choix automatique au ping.
- Côté client, il faut fusionner les boîtes statiques d'une carte en une seule géométrie par matériau (une poignée de draw calls au lieu de plusieurs centaines sur Quartier), utiliser des matériaux instanciés pour les joueurs, et adapter automatiquement la résolution de rendu au framerate.
- Côté serveur, il faut surveiller `tickStats` (déjà exposé dans `/health`) et sortir la simulation des bots et des monstres dans un worker si le tick dépasse 10 ms de travail.

### 3.7 Code

- Découper `server/index.js` (environ 1600 lignes) en `rooms.js`, `combat.js`, `movement.js`, puis un module par mode (`modes/survival.js`, `modes/gungame.js`).
- Découper `game.js` de la même façon (réseau, rendu, entrées, effets).
- Poser un petit système de types via JSDoc et `// @ts-check` pour attraper les erreurs de propriété sans ajouter de build.
- Brancher une CI GitHub Actions qui lance `npm test` à chaque push et bloque le déploiement si un test casse.

## 4. Ordre conseillé

1. **Déployer cette version** et vérifier dans les logs du Space que `X-Forwarded-For` est bien présent. Sans lui, tous les joueurs partageraient la même IP et la limite de 8 par IP bloquerait le neuvième. `MAX_PER_IP=1000` désactive la limite en attendant.
2. **Sensation de jeu** (glissade, contrôle aérien, coyote time, retours de tir). C'est ce qui donne envie de rejouer, et ça reste côté client.
3. **Physique partagée et serveur autoritaire**. C'est le plus gros chantier, et il débloque l'anti-triche, les munitions serveur et la killcam.
4. **Comptes, XP et classement** avec Supabase.
5. **Nouvelles cartes et éditeur**.
6. **Serveur toujours allumé et multi-régions** quand il y a du monde.

## 5. Pièges à garder en tête

- Tout ce qui est affiché au joueur doit venir de `shared/config.js`, comme la fiche d'arme maintenant. Des chiffres écrits à la main divergent dès le premier rééquilibrage.
- Une recherche du type `objet[entrée_utilisateur]` doit toujours passer par `Object.hasOwn`. C'est exactement ce qui faisait tomber le serveur.
- Un nouveau mouvement rapide (dash, tremplin, téléporteur) doit appeler `moveBoost` ou `resetMove` côté serveur, sinon le contrôle des déplacements recalera les joueurs honnêtes.
- Les tests qui téléportent des joueurs doivent tourner avec `MOVE_CHECK=0`, comme le smoke test.
