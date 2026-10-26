# Séquenceur pas à pas

Un séquenceur de batterie et de mélodie, dans le même esprit que Chord Scales :
9 pistes de batterie, une piste mélodique (gamme et fondamentale au choix, un instrument par case),
tempo, swing, subdivisions (croches, triolets, doubles-croches).
Il fonctionne sans connexion et s'installe sur l'écran d'accueil de l'iPhone.

## Essayer tout de suite (sur le Mac)

1. Décompressez le zip (double-clic).
2. Double-cliquez sur `index.html` : l'appli s'ouvre dans le navigateur.

Dans ce mode, les sons de la mélodie se chargent depuis le dossier. Le mode « hors ligne » et
l'installation sur iPhone demandent en revanche une publication sur un site (voir ci-dessous).

## Publier sur GitHub Pages (sans Terminal)

1. Dans GitHub Desktop : *File ▸ New repository…* — nom, par exemple `Sequenceur`,
   dossier local de votre choix. Cochez « Initialize with a README » seulement si vous le souhaitez.
2. Copiez **tout le contenu** du dossier décompressé (`index.html`, `sw.js`, `manifest.webmanifest`,
   `app/`, …) dans le dossier du dépôt.
3. Dans GitHub Desktop : *Commit to main*, puis *Publish repository* (décochez « Keep this code private »).
4. Sur github.com, dans le dépôt : *Settings ▸ Pages ▸ Build and deployment* :
   Source « Deploy from a branch », branche `main`, dossier `/ (root)`, puis *Save*.
5. Au bout d'une minute, l'appli est disponible à l'adresse
   `https://harmoniamundi.github.io/Sequenceur/` (adaptez au nom du dépôt).

## Installer sur l'iPhone

1. Ouvrez l'adresse ci-dessus dans **Safari**.
2. Laissez la page ouverte quelques secondes : une pastille « Sons hors ligne : x/3 » apparaît
   en bas à gauche pendant le téléchargement des instruments (environ 8 Mo), puis « Prêt hors ligne ».
3. Bouton Partager ▸ **Sur l'écran d'accueil**.

Ensuite l'appli s'ouvre comme une application et joue même sans réseau.

### Mode silencieux et écran allumé

- **Son malgré le mode silencieux** : l'appli déclare à iOS qu'elle « lit un média » (`navigator.audioSession`,
  iOS 16.4 et plus ; sur un iPhone plus ancien, une piste muette tourne en boucle pour obtenir le même effet).
  Le volume de l'iPhone (boutons latéraux) reste, lui, actif.
- **Écran qui ne s'éteint pas** tant que l'appli est affichée (API *Wake Lock*, iOS 16.4 et plus ; sur un iPhone
  plus ancien, une mini-vidéo muette invisible joue en boucle). Si on quitte l'appli ou verrouille l'iPhone à la main,
  l'écran se comporte normalement ; au retour, le maintien se réactive tout seul.
- Ces deux réglages démarrent au **premier toucher** de l'écran (règle d'iOS). Pensez à brancher l'iPhone si la
  séance est longue : écran allumé = batterie qui baisse plus vite. En mode économie d'énergie, iOS peut refuser de
  garder l'écran allumé.

## Gammes et modes

Le menu « Gamme » reprend les 74 gammes et modes de Mode Machine, avec les mêmes noms, les mêmes groupes et la même écriture des notes
(diatoniques, mineure mélodique, mineure harmonique et hongroises, exotiques, pentatoniques et blues, symétriques, maqâmat,
gammes indiennes et thātas carnatiques, dastgāhs, gamelans), plus la **gamme chromatique** (12 notes, groupe « Symétriques & Autres »).
La grille compte autant de lignes que la gamme a de notes (jusqu'à 25 : chromatique sur 2 octaves).
Les gammes sont décrites dans `app/theory.js` (liste `SCALES`) ; `node app/theory.test.js` vérifie leur écriture.

## Instruments de la mélodie (un par case)

Au-dessus de la grille mélodique, la palette « Instrument des cases » : on choisit un instrument, puis les cases
posées prennent **sa couleur et son son**, jusqu'à ce qu'on en choisisse un autre. Chaque case garde son instrument,
on peut donc mélanger (une ligne de basse, un accord d'orgue, une mélodie de flûte…).

- **Superposition** : cliquer une case déjà prise par un autre instrument ajoute l'instrument choisi sur une **ligne en dessous**, au même degré et au même pas (3 couches au plus par degré). La ligne apparaît quand elle contient une note et disparaît quand elle est vide.
  Recliquer là où l'instrument choisi est déjà présent le retire. **Alt + clic** remplace la case cliquée par l'instrument choisi ; **Maj + clic** efface la case cliquée, quel que soit son instrument.
  Un même instrument ne se pose qu'une fois par degré et par pas.
- Des cases voisines d'un **même instrument** sur un même degré forment une note tenue (même si elles sont sur des couches différentes) ; un autre instrument recommence une note.
- « Octave » (à droite de la palette) décale tout un instrument de −3 à +3 octaves sans toucher à la grille
  (la basse est proposée 2 octaves plus bas, comme son registre naturel).
- 15 instruments : Piano, Basse et Trompette (échantillons) ; Orgue, Guitare, Cordes, Basse synthé, Flûte,
  Clarinette, Marimba, Vibraphone, Carillon, Synthé, Chiptune et Nappe (synthèse FM à 6 opérateurs calculée dans le navigateur : rien à télécharger, utilisables hors ligne, et **éditables**, voir plus bas).
- **Mélange** : dans la colonne de gauche, sous « Volumes », un curseur par instrument qui joue dans la mélodie (plus celui de la palette, pour le régler avant de poser des cases), à la couleur de l'instrument. De 0 à 150 % ; 100 = niveau d'origine. Le curseur « Mélodie » reste le niveau général de l'ensemble. Relâcher un curseur fait entendre l'instrument à son nouveau niveau ; les niveaux sont enregistrés avec le reste.
  Chaque instrument a aussi ses boutons **M** (couper) et **S** (l'écouter seul), comme les pistes de batterie : plusieurs solos s'additionnent, la ligne d'un instrument coupé ou hors solo s'estompe, et le son déjà parti (une nappe tenue) s'arrête aussitôt. Le solo ne concerne que les instruments de la mélodie, pas la batterie. Un solo laissé sur un instrument qui n'a plus aucune note est ignoré. Coupures et solos sont enregistrés avec le reste.
- Les anciennes sauvegardes sont reprises : leurs cases prennent l'instrument qui était alors choisi (elles forment la ligne principale).
- « Au hasard », « Générer » et « Vider » remplacent toute la mélodie, couches comprises.

## Éditeur de son (façon synthé FM à 6 opérateurs)

Bouton **Éditer le son** (au-dessus de la palette d'instruments), ou clic sur le nom d'un instrument dans le mélangeur. Une fenêtre s'ouvre,
avec en haut la liste des instruments (on peut en changer sans la fermer), en bas les quatre onglets du synthé et un clavier d'essai.
Chaque réglage fait entendre le résultat un instant après ; pendant la lecture, il s'applique aux notes suivantes.

- **edit** (instruments synthétisés) : l'écran d'un DX7.
  - *Algorithme* (1 à 32, flèches ‹ ›) : le schéma montre quels opérateurs en modulent d'autres (en bas : ceux qu'on entend ; trait pointillé : retour / feedback).
  - *OP1 à OP6* : cliquer sur « OPn » l'allume ou l'éteint ; les barres montrent son niveau. Enveloppe à 4 vitesses (R1–R4) et 4 niveaux (L1–L4), qu'on règle
    en tapant les nombres ou en **tirant les points de la courbe** (haut-bas : niveau ; gauche-droite : vitesse) ; la partie en pointillé est le maintien tant que la note dure.
    *Frequency* : rapport (« f×1.0-3 » = coarse 1, fine 3) ou fréquence fixe en Hz, plus detune. *KBD scale* : le niveau change de part et d'autre d'un point de rupture
    (courbes −lin, −exp, +exp, +lin, profondeurs gauche et droite) et « rate » accélère les enveloppes dans l'aigu. *M sens* : sensibilité au LFO d'amplitude ;
    *V sens* : sensibilité à la force de la note (les notes de faible probabilité, les répétitions d'un ratchet et le verrou « volume » sonnent moins fort et moins brillant) ; *level* : niveau de sortie.
  - *Feedback*, *do du milieu* (transposition du patch), *osc key sync* (les opérateurs repartent de zéro à chaque note).
  - *LFO* (forme, vitesse, délai, PMD / AMD profondeur de vibrato / de trémolo, PMS sensibilité au vibrato) et *enveloppe de hauteur* (50 = hauteur normale).
  - Astuce : sur un champ, on peut **faire glisser l'étiquette** vers le haut ou le bas pour changer la valeur (Maj = plus vite) ; la molette marche aussi.
- **edit** (piano, basse, trompette) : ce sont des enregistrements ; on règle seulement leur enveloppe (attaque, descente, maintien, relâchement).
- **param** (tous les instruments) : *filter* (fréquence de coupure, résonance, saturation), *delay* (temps, feedback, mélange), *controller* (accord en centièmes de ton, panoramique, volume).
  Boutons rotatifs : glisser de haut en bas (Maj = fin), molette ou flèches du clavier.
- **cart** : les 12 patchs d'usine ; en charger un le met à la place du patch de l'instrument (bouton « Annuler le chargement »).
- **setup** : le son de l'instrument en texte (à copier pour le garder, ou à coller pour en charger un reçu), copie vers un autre instrument, retour au son d'usine, patch vide.

Les sons sont enregistrés avec le reste, dans le navigateur. Pas de pitch bend, de molette de modulation ni de mode mono / portamento : un séquenceur n'en a pas besoin.
Les 32 algorithmes sont ceux du DX7, redessinés de mémoire à partir de leur schéma ; un schéma (surtout parmi les n° 7 à 18) pourrait différer d'un détail de l'original.

## Styles de batterie et mélodie « au hasard »

15 styles : Rock, Punk, Disco, House, Funk, Boom bap, Trap, Drum & bass, Reggae, Bossa, Salsa (clave 3-2), Jazz,
Shuffle blues, Afro 12/8 et Ballade 12/8 (les quatre derniers en triolets). Le style se choisit en haut de la colonne de gauche ; il règle la batterie, le tempo,
le swing et la subdivision.

Deux boutons par zone (batterie et mélodie) :

- **Au hasard** : tirage libre, sans tenir compte du style (batterie : probabilités fixes par instrument ; mélodie : marche de proche en proche dans la gamme).
- **Générer** : une autre proposition **dans le dernier style choisi** (le style reste mémorisé, et affiché par la pastille violette dans la barre de la mélodie, même si vous modifiez ensuite le rythme).
  - Batterie : on part du rythme du style, dont on garde l'ossature (grosse caisse sur le 1, caisse claire, claves intactes), puis on varie : reprises de grosse caisse, doubles-croches de charleston, notes fantômes, parfois un roulement sur le dernier temps. Les pistes absentes du style restent vides. Le style règle aussi la subdivision (croches, triolets, doubles-croches) ; le tempo et le swing ne changent pas.
  - Mélodie : densité de notes, part des temps et des contretemps (reggae : surtout les contretemps ; ballade : peu de notes, tenues), notes tenues, motif court répété sur la mesure (rock, funk, salsa…), amplitude des sauts (jazz : larges et en gammes ; punk : notes répétées). Les notes sont attirées vers les pas où jouent la grosse caisse, la caisse claire et les instruments rythmiques (rim, claves, cloche, tom) : la mélodie colle à la batterie posée, même modifiée à la main.

La gamme, la fondamentale, l'étendue et l'instrument de la palette restent ceux que vous avez choisis.
Pour régler un style ou en créer un : `PRESETS` (champ `feel` pour la mélodie) et `GEN` (batterie) dans `app/sequencer.js`.

## Fonctions avancées (par pas et par piste)

Bouton **Régler les pas** (puis toucher un pas), ou clic droit, ou appui long au doigt : un panneau s'ouvre.

- **Probabilité** : chance (0–100 %) que le pas joue à chaque tour. Le pas devient plus transparent. Idéal pour les notes fantômes.
- **Condition « A:B »** : le pas ne joue qu'au tour A de chaque série de B tours (ex. 1:4 = seulement au 1er tour sur 4). « Sauf ce tour » inverse la règle.
- **Répétitions (ratchet)** : le pas est découpé en 2, 3, 4, 6 ou 8 coups rapides (roulements, bégaiements). Sur une note tenue de la mélodie, la note est répétée sur toute sa durée.
- **Verrous de paramètres** : volume, filtre, panoramique, réverbération (et octave pour la mélodie) ne valent que pour ce pas.
- **Longueur de boucle par piste** (polymétrie) : le petit bouton « 16→ » de chaque piste (« Boucle 16 → » pour la mélodie) règle sa longueur de 1 à 16 pas. Une piste de 15 pas contre une de 16 se décale à chaque tour.
- **Sens de lecture par piste** : avant, arrière, va-et-vient, hasard.

Un coin blanc sur un pas signale une condition, des répétitions ou un verrou. Pour la mélodie, les réglages d'un pas valent pour toutes les notes de ce pas.
Les conditions comptent les tours de la boucle de chaque piste, depuis le début de la lecture.

## Utilisation

- Une case = un pas. Clic (ou doigt) pour poser/retirer ; glisser le long d'une ligne pour peindre.
- Mélodie : des cases voisines d'un même instrument sur une même ligne forment une seule note tenue.
- Clic sur le nom d'une piste ou d'une note : on l'entend.
- M = couper la piste, S = l'écouter seule. Barre d'espace = jouer/arrêter.
- Réglages (style, tempo, tap tempo, subdivision, swing, volumes) : colonne de gauche ;
  sur téléphone, bandeau « Réglages » à déplier.
- Tout est enregistré automatiquement dans le navigateur (le motif reste au prochain lancement).

## Contenu

```
index.html              la page
sw.js                   mémoire hors ligne (doit rester à côté de index.html)
manifest.webmanifest    installation sur l'écran d'accueil
app/
  sequencer.js          la grille, la lecture, les réglages
  audio-engine.js       le son (batterie synthétisée, échantillons, notes FM) et la liste des instruments (TIMBRES)
  editor.js             l'éditeur de son (fenêtre « Éditer le son »)
  theory.js             gammes et noms de notes (+ theory.test.js : « node app/theory.test.js »)
  style.css             la mise en forme
  offline.js            enregistrement du mode hors ligne
  keepalive.js          iPhone : son en mode silencieux, écran toujours allumé
  audio/                synthés de batterie, moteur FM et patchs d'usine (fm-synth.js, avec fm-synth.test.js : « node app/fm-synth.test.js »),
                        voix de secours (synth-voices.js), chargement local des sons
  sounds/               piano, trompette, basse électrique (environ 8 Mo)
  vendor/, fonts/, icons/, licenses/
```

Si vous ajoutez ou enlevez un fichier, mettez à jour la liste `SHELL_FILES` dans `sw.js`.

### Ajouter un instrument

- **Synthétisé (FM)** : écrire son patch d'usine dans `app/audio/fm-synth.js` (un appel `def('identifiant', algorithme, feedback, [opérateurs], { LFO… })`,
  son niveau dans `TRIM`), puis une ligne dans `TIMBRES` de `app/audio-engine.js` (nom, couleur, décalage d'octaves). Le plus simple : le construire dans l'éditeur,
  copier son texte (onglet « setup ») et le recopier dans `fm-synth.js`.
- **À échantillons** : copier son fichier (ex. `violin-mp3.js` de la banque FluidR3_GM, projet MIDI.js Soundfonts) dans `app/sounds/FluidR3_GM/`,
  l'ajouter à `LOCAL_SOUNDFONT_INSTRUMENTS` (`app/audio/local-soundfonts.js`), puis une ligne dans `TIMBRES` avec `sf` et `bank`.

## Licences

Police Kalam (SIL OFL), échantillons MIDI.js Soundfonts (FluidR3_GM, MusyngKite) et
soundfont-player : voir le dossier `app/licenses/`.
