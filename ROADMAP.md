# FPIXEL, synthèse du projet et chemin vers un niveau Krunker

## 1. Où en est le jeu

FPIXEL est un FPS multijoueur dans le navigateur, en low-poly pixelisé, pensé pour jouer entre potes. Le client est statique (Vercel) et le serveur est un process Node avec une seule dépendance (`ws`) qui tourne sur un Space Hugging Face gratuit. Il n'y a ni build ni framework, three.js est vendorisé, et tout le code partagé (armes, cartes, physique de l'avion) vit dans `web/shared/` pour que le client et le serveur calculent exactement la même chose.

Le contenu est déjà large pour un projet solo. Il y a cinq modes (chacun pour soi, équipes, duel, Gun Game, Survie en coop avec boutique et manches — le mode Braquage a été retiré), cinq cartes (Arène, Village, Entrepôt, Chantier, Quartier), sept classes plus une classe Perso à budget de points, une vingtaine d'armes dont plusieurs vraiment originales (portail, grappin, Excalibur et son onde, canon à orbe, avion en papier piloté, missile nucléaire avec gaz), des séries de kills, des bots avec pathfinding et trois niveaux, des monstres, la reconnexion automatique avec jeton et un mode tactile complet.

Le netcode est sain sur le principe. Les tirs sont rejoués côté serveur avec compensation de lag (rembobinage des positions jusqu'à 400 ms), les autres joueurs sont interpolés, et la dispersion est déterministe grâce à une graine imposée par le serveur. Les tests sont sérieux pour un projet perso : une suite physique, un smoke test qui ouvre de vraies connexions WebSocket, une suite sécurité et une suite menu.

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
- Les salons de Survie en solo ne sont plus listés publiquement. Leur nom dérivait du jeton de reconnexion, et n'importe qui pouvait les rejoindre. Le serveur sait aussi rejoindre un salon précis par son identifiant (`rid`), ce qu'utilise le navigateur de salons du menu.

**Menu refait de zéro**

- La disposition passe en trois colonnes (mode et carte, arsenal, partie) avec une barre du bas toujours visible. On y trouve le pseudo, un résumé de ce qu'on va lancer et le bouton JOUER. Sur téléphone en paysage, chaque colonne défile de son côté et JOUER ne sort jamais de l'écran.
- Les cinq modes sont des tuiles directes (les anciennes catégories Multijoueur / Survie / Fun sont retirées).
- Les cartes s'affichent en vignettes vues du dessus, générées depuis `shared/map.js`. Elles restent justes si une carte change.
- Choix « Partie rapide » ou « Entre potes », avec un nom de salon et un bouton qui copie un lien d'invitation (`?room=potes&mode=tdm&map=village`) réglant tout pour les amis.
- Un navigateur de salons liste les salons ouverts du mode choisi (nom, carte, remplissage) et permet de les rejoindre en un clic.
- Les contrôles s'affichent sur un clavier dessiné, les stats sur une petite grille, et le statut serveur est visible en permanence. Quand le Space dort, le bouton lui-même affiche « RÉVEIL DU SERVEUR… 12 s ».

**Classes et armes**

- Les icônes d'armes sont en vrai pixel art, dessinées à la main sur une grille 24×12, avec contour noir et aplats. Il n'y a plus de rendu WebGL hors écran, donc plus de miniatures floues, de second contexte GPU ni de géométries qui ne sont jamais libérées. Les mêmes icônes servent dans le menu, le HUD, la barre tactile, la boutique et le killfeed.
- Les cartes de classe ne contiennent plus de boutons imbriqués, se parcourent au clavier et ont les bons rôles ARIA.
- La fiche d'arme s'affiche en bulle flottante et donne des chiffres justes : dégâts par tir (le sniper n'apparaît plus comme la pire arme), meilleure précision possible (lunette ou visée), portée réelle, étiquettes (Tête = kill, 1 tir = kill, Zone, Utilitaire, Pilotée…).
- Regarder une arme de sa propre classe ne change plus de classe.
- La classe Perso ne peut plus se bloquer. Les armes trop chères restent visibles avec « manque 3 pts », un avertissement apparaît si la liste est vide, et JOUER se désactive au lieu de lancer la partie en Classique sans rien dire.
- Les modes imposés montrent ce qu'on aura vraiment : la frise des niveaux en Gun Game, l'équipement de départ en Survie. En Survie, la difficulté des monstres redevient réglable.

**Tests**

`npm test` lance quatre suites (physique, menu en jsdom, smoke multijoueur, sécurité), toutes vertes.

## 3. Ce qui sépare FPIXEL de Krunker

Krunker n'est pas meilleur parce qu'il a plus d'armes. Il l'est parce que chaque seconde de jeu est nerveuse, parce que le jeu est juste (le serveur décide), et parce qu'il y a toujours une raison de relancer une partie. Voici l'écart domaine par domaine.

### 3.1 Sensation de jeu

C'est le plus important et c'est là que Krunker est imbattable. Le mouvement y est une compétence : glissade au sol qui conserve la vitesse, bunny hop avec contrôle aérien, saut accroupi, strafe qui accélère.

**Fait (septembre 2026)** :
- **Glissade** : C en plein sprint au sol. Départ à sprint × 1,2, décélération lente (5 m/s²), silhouette et caméra basses, recharge de 1,1 s. Sauter pendant la glissade garde l'élan (7 % perdu à chaque saut enchaîné), donc le « slide-hop » existe mais ne s'emballe pas.
- **Contrôle aérien** façon Quake : en l'air, on accélère vers la direction voulue sans jamais freiner l'élan acquis (plafonné à la vitesse de départ).
- **Coyote time** (100 ms) et **saut mémorisé** (120 ms).
- **FOV dynamique** (+5 % en sprint, +10 % en glissade), petite secousse de caméra et son à l'atterrissage d'une chute.
- **Retours de tir** : chiffres de dégâts flottants (cumulés pour les plombs d'un même tir, jaunes pour la tête, rouges pour le kill), marqueur de touche jaune pour la tête.
- Côté serveur, la glissade est annoncée (`{t:'slide'}`, au plus une par seconde) et n'ouvre qu'un petit bonus de vitesse de 0,9 s : le contrôle anti-speedhack reste aussi strict.

**Reste à faire** : mouvement de l'arme (balancement, recul qui remonte la vue puis revient), léger ralenti sur un kill, sons de kill qui montent avec la série, glissade sur mobile plus lisible (bouton dédié).

La physique (`web/js/physics.js`) devra passer dans `web/shared/` pour le serveur autoritaire (voir 3.2). Les réglages de « sensation » n'agissent que si `p.feel` est vrai (joueur local), les bots gardent l'ancienne physique.

### 3.2 Serveur autoritaire

Aujourd'hui le client calcule sa position et le serveur vérifie seulement la vitesse. C'est suffisant contre les tricheurs basiques, mais pas pour un jeu public.

La cible est le modèle classique des FPS compétitifs. Le client envoie ses entrées numérotées (touches, angles, dt) au lieu de sa position. Le serveur simule avec la même physique partagée et renvoie son état avec le numéro de la dernière entrée traitée. Le client prédit localement, puis rejoue les entrées non confirmées depuis l'état serveur (réconciliation). Une fois ce modèle en place, plusieurs trous se ferment d'eux-mêmes : le noclip, l'anti-recul (les impulsions sont appliquées par le serveur), le faux état de visée (le serveur sait si tu vises et depuis quand), et les munitions (le serveur compte).

À faire en même temps : calculer le temps de rembobinage depuis le RTT mesuré plutôt que de prendre la valeur du client, et passer les snapshots en binaire (ArrayBuffer, positions quantifiées sur 16 bits, envoi en delta) dès qu'on vise plus de dix joueurs par salon.

### 3.3 Contenu, cartes et lisibilité

**Fait (septembre 2026)** :
- **Rendu des cartes** (`web/js/world.js`) : une texture pixel dessinée par matériau (briques, planches, tôle nervurée, pierre, tuiles…), ombre de contact au pied des murs, variation de teinte d'une boîte à l'autre, et un sol peint d'un seul tenant avec des chemins, des places pavées, des routes avec trottoirs et pointillés, et des **ombres portées précalculées** (soleil fixe). Toutes les boîtes d'un même matériau sont fusionnées en un seul maillage : une dizaine de draw calls au lieu de plusieurs centaines sur Quartier.
- **Tracé** : trois niveaux de jeu là où il n'y en avait qu'un. Toits accessibles avec parapet sur les grandes maisons du Village et sur les 4 immeubles autour de la place du Quartier, passerelle centrale en hauteur dans l'Entrepôt, abris devant les apparitions d'équipe dans l'Arène.
- **Apparitions** : le serveur écarte les points qu'un ennemi voit (ligne de vue jusqu'à 45 m), fini les « spawn kills » en face de l'ennemi.
- **Nouvelle carte Chantier** (68 × 68 m) : trois couloirs bien distincts (parc à conteneurs, bâtiment en construction avec dalle à l'étage, échafaudage), trois niveaux, symétrique en Z, couverts devant les apparitions. Pensée pour la glissade.

**Reste à faire** :
- Tester les cartes en vraie partie et ajuster (durée moyenne entre deux rencontres, lignes de vue trop longues, positions trop fortes).
- Un **éditeur de cartes** dans le navigateur (une carte n'est qu'une liste de boîtes) et le partage de cartes par lien.
- **Lisibilité** : contour de couleur sur les ennemis et les alliés, silhouette visible dans la fumée, effets allégés sur mobile.
- ~~Réticule personnalisable~~ : fait (forme croix / croix + point / T / point / cercle, taille, écart, épaisseur, couleur, contour, aperçu en direct dans les réglages, `web/js/crosshair.js`). Reste la **sensibilité par arme**.
- **Killcam** de trois secondes (le serveur a déjà l'historique des positions) et **spectateur** entre deux vies en duel.

### 3.4 Progression et raison de revenir

C'est ce qui manque le plus en dehors du gameplay.

- **Comptes légers** : pseudo plus code secret, ou connexion Google, stockés dans une vraie base. Supabase est le choix naturel, il est déjà connecté à ton environnement.
- **Camouflages d'armes** : fait sans base de données (`web/shared/skins.js`, `web/js/armory.js`). 7 skins par arme (Standard, Désert, Forêt, Nuit, Braise, Or, Diamant) débloqués à 10 / 25 / 50 / 100 / 200 / 400 frags avec l'arme, comptés dans le navigateur (`fpixel-stats-v1`, champ `wk`). Le serveur valide le choix (`cleanSkins`) et le montre aux autres joueurs ; un bot sur deux porte un camouflage. Limites connues : trichable côté navigateur (sans enjeu, c'est visuel) et perdu si on vide le navigateur ou change d'appareil.
- **Niveau de joueur et XP** par partie, **défis quotidiens** (« 10 frags au revolver »). Pour que la progression suive d'un appareil à l'autre : profil anonyme sur Supabase avec un **code de récupération** (pas d'email ni de mot de passe).
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

Ce que les joueurs attendent d'un FPS en navigateur, par ordre d'impact : un mouvement qui récompense la maîtrise (fait en partie), des retours de tir nets (fait), des cartes lisibles à trois couloirs et plusieurs niveaux (fait sur 5 cartes, à valider en jeu), un jeu juste (serveur autoritaire), une raison de revenir (progression, classement), et de quoi jouer avec ses potes sans friction (lien d'invitation fait, chat et groupe à faire).

1. **Jouer entre potes sur les nouvelles cartes** et noter ce qui coince (couloirs trop longs, positions trop fortes, glissade trop forte ou trop faible). Les réglages sont en haut de `web/js/physics.js` et de `game.js` (`SLIDE_*`).
2. **Progression** : XP par partie, niveaux, défis quotidiens, camouflages d'armes (les icônes pixel s'y prêtent), avec des comptes légers sur Supabase. C'est ce qui manque le plus pour faire revenir les joueurs.
3. **Killcam + réticule personnalisable + contours ennemis** : peu de code, gros gain de confort.
4. **Physique partagée et serveur autoritaire** : le plus gros chantier. Il débloque l'anti-triche complet, les munitions côté serveur et une killcam exacte.
5. **Éditeur de cartes** et cartes de la communauté.
6. **Serveur toujours allumé et multi-régions** quand il y a du monde (le Space gratuit s'endort).

## 5. Pièges à garder en tête

- Tout ce qui est affiché au joueur doit venir de `shared/config.js`, comme la fiche d'arme maintenant. Des chiffres écrits à la main divergent dès le premier rééquilibrage.
- Une recherche du type `objet[entrée_utilisateur]` doit toujours passer par `Object.hasOwn`. C'est exactement ce qui faisait tomber le serveur.
- Un nouveau mouvement rapide (dash, tremplin, téléporteur) doit appeler `moveBoost` ou `resetMove` côté serveur, sinon le contrôle des déplacements recalera les joueurs honnêtes. La glissade passe par le message `slide` (bonus limité à une fois par seconde).
- Une boîte avec `y0 >= 1,8` (dalle, passerelle) est ignorée par la grille de navigation des bots : ils passent dessous mais ne montent pas dessus.
- Les positions de test du smoke test sont codées en dur sur l'Arène (couloir x = -15) : vérifier qu'un nouveau décor ne les coupe pas.
- Les tests qui téléportent des joueurs doivent tourner avec `MOVE_CHECK=0`, comme le smoke test.
