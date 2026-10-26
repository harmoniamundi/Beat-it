# Séquenceur pas à pas

Un séquenceur de batterie et de mélodie, dans le même esprit que Chord Scales :
9 pistes de batterie, une piste mélodique (gamme et fondamentale au choix, un instrument par case),
tempo, swing, subdivisions (croches, triolets, doubles-croches), accents, humanisation, 8 patterns enchaînables en chanson,
export audio (WAV) et MIDI.
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
2. Laissez la page ouverte quelques secondes : une pastille « Sons hors ligne : x/26 » apparaît
   en bas à gauche pendant le téléchargement des instruments (environ 17 Mo), puis « Prêt hors ligne ».
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
- 15 instruments, chacun avec **plusieurs sons au choix** (voir « Éditeur de son ») : Piano, Basse et Trompette (enregistrements
  d'instruments réels) ; Orgue, Guitare, Cordes, Basse synthé, Flûte, Clarinette, Marimba, Vibraphone, Carillon et Nappe
  (échantillons légers tirés de la banque TimGM6mb) ; Synthé et Chiptune (synthétiseur calculé dans le navigateur).
- **Mélange** : dans la colonne de gauche, sous « Volumes », un curseur par instrument qui joue dans la mélodie (plus celui de la palette, pour le régler avant de poser des cases), à la couleur de l'instrument. De 0 à 150 % ; 100 = niveau d'origine. Le curseur « Mélodie » reste le niveau général de l'ensemble. Relâcher un curseur fait entendre l'instrument à son nouveau niveau ; les niveaux sont enregistrés avec le reste.
  Chaque instrument a aussi ses boutons **M** (couper) et **S** (l'écouter seul), comme les pistes de batterie : plusieurs solos s'additionnent, la ligne d'un instrument coupé ou hors solo s'estompe, et le son déjà parti (une nappe tenue) s'arrête aussitôt. Le solo ne concerne que les instruments de la mélodie, pas la batterie. Un solo laissé sur un instrument qui n'a plus aucune note est ignoré. Coupures et solos sont enregistrés avec le reste.
- Les anciennes sauvegardes sont reprises : leurs cases prennent l'instrument qui était alors choisi (elles forment la ligne principale).
- « Au hasard », « Générer » et « Vider » remplacent toute la mélodie, couches comprises.

## Éditeur de son

Bouton **crayon** ✎ (à côté du titre « Instrument des cases », au-dessus de la palette), ou clic sur le nom d'un instrument dans le mélangeur.
Une fenêtre s'ouvre ; en haut, la rangée des instruments (on peut en changer sans la fermer), en bas le bouton **Écouter** et les boutons *Annuler le changement* / *Réglages d'origine*.
Chaque réglage fait entendre le résultat un instant après ; pendant la lecture, il s'applique aux notes suivantes.

1. **Son** : des tuiles à toucher, par exemple pour l'orgue *Drawbars, Rock, Église*, pour la guitare *Nylon, Acier, Électrique*,
   pour les cordes *Ensemble, Violon, Violoncelle, Pizzicato*… Le dernier choix, « Synthé FM (DX7) », ouvre le moteur FM à 6 opérateurs (voir plus bas).
2. **Forme de la note** : une petite courbe qui suit les curseurs. *Attaque* (du coup sec au lever lent) et *Relâchement* (de la note coupée à la traîne longue) ; pour les synthés, *Descente* et *Maintien* en plus.
3. **Timbre** (*Brillance*, *Mordant*), **Mouvement** (*Vibrato*, *Chorus*), **Espace** (*Écho*, *Réverbération*), **Niveau** (*Volume*, *Position gauche-droite*, *Accord*) :
   des curseurs avec leur description en français et leurs deux extrémités (« sourd » ↔ « brillant »).
4. **Réglages avancés** (repliés) : pour les synthés, forme d'onde, voix superposées, filtre et enveloppe ; pour tous, résonance, vitesse du vibrato, temps et répétition de l'écho.

### Synthé FM (DX7), pour les connaisseurs

Chaque instrument qui avait un patch FM d'usine garde ce patch sous la tuile « Synthé FM (DX7) » : algorithmes 1 à 32, opérateurs OP1 à OP6 avec enveloppes à 4 vitesses et 4 niveaux
(à régler en tapant les nombres ou en tirant les points de la courbe), fréquences, mise à l'échelle du clavier, sensibilités, feedback, LFO, enveloppe de hauteur, patchs d'usine,
export / import du son en texte. Sur un champ, on peut **faire glisser l'étiquette** vers le haut ou le bas pour changer la valeur (Maj = plus vite).
Les 32 algorithmes sont ceux du DX7, redessinés de mémoire ; un schéma (surtout parmi les n° 7 à 18) pourrait différer d'un détail de l'original.

Les sons sont enregistrés avec le reste, dans le navigateur. Les anciennes sauvegardes sont reprises : un patch FM que vous aviez modifié est conservé (tuile « Synthé FM »),
les autres instruments prennent leur nouveau son ; les anciens réglages d'enveloppe des échantillons deviennent *Attaque* et *Relâchement*.

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

## Accents, notes fantômes, humanisation

- **Force d'un coup de batterie** : trois niveaux, *normal*, *accent* (anneau blanc) et *fantôme* (assombri, environ 40 % de la force).
  Bouton **Accents** (barre de la batterie) : tant qu'il est allumé, chaque toucher fait passer le pas de éteint à normal, puis accent, puis fantôme, puis éteint ;
  en glissant, on applique la même force à plusieurs pas. **Alt + clic** sur un pas allumé fait passer de normal à accent, puis à fantôme, sans passer par le mode.
  Le panneau d'un pas (« Régler les pas », clic droit ou appui long) a aussi un choix *Fantôme / Normal / Accent*.
- **Humanisation** (colonne de gauche) : *Placement* (écart aléatoire jusqu'à ±18 ms) et *Force* (jusqu'à ±30 %), pour un jeu moins mécanique. À 0, rien ne change.
  Elle joue à la lecture et dans l'export WAV, pas dans le fichier MIDI.
- **Décalage d'une piste** : dans le réglage de boucle d'une piste (le petit bouton « 16→ »), curseur de −40 % à +40 % d'un pas ; vers le + la piste joue en retard (caisse claire
  « laid back »), vers le − en avance. Chaque piste de batterie, et la mélodie, a le sien.

## Patterns et chanson

- **8 patterns (A à H)**, en haut de la page : chacun a sa propre batterie, sa mélodie, ses réglages de pas et de piste (boucles, sens, décalages). Le tempo, le swing, la subdivision,
  la gamme, les volumes et les sons des instruments sont communs. Un point sur la lettre signale un pattern qui contient quelque chose.
  Choisir un autre pattern pendant la lecture change tout de suite ce qu'on entend.
- **Copier / Coller** : copie le pattern affiché et le colle par-dessus un autre (pour faire un B à partir de A, puis le varier).
- **Chanson** : un bouton qui enchaîne les patterns. Une étape = un pattern joué 1, 2, 4 ou 8 mesures ; on les ajoute (« + Ajouter » ajoute le pattern affiché), on les choisit pour changer
  leur pattern ou leur durée, les déplacer (← →) ou les retirer. La chanson reboucle à la fin ; une pastille verte marque le pattern et l'étape qui jouent.
  En mode Chanson, la lecture suit les étapes et le pattern affiché sert à les modifier ; à chaque nouvelle étape, les boucles de pistes (polymétrie) et les conditions A:B repartent du début.
  Le premier allumage préremplit la chanson avec les patterns non vides, dans l'ordre.
- Tout est enregistré avec le projet (projets, export, annuler / refaire). Les anciennes sauvegardes sont reprises : leur motif devient le pattern A.

## Exporter (audio et MIDI)

Bouton **Exporter** (en haut à gauche). On choisit la durée : le nombre de mesures du pattern affiché (1 à 16) ou, en mode Chanson, la chanson entière une fois.

- **Mix (WAV)** : 16 ou 24 bits entiers, ou 32 bits flottants, 44,1 kHz stéréo. Le rendu est fait par le navigateur, plus vite que le temps réel ; il tient compte des coupures (M), des solos (S),
  des volumes, des sons édités, de l'humanisation, du swing, des probabilités et conditions (tirées une fois pour toutes dans le fichier). *Boucle parfaite* (hors chanson) : la fin des sons
  (échos, réverbération) revient au début du fichier, pour qu'il boucle sans coupure. En entiers, un son qui dépasserait 0 dB est ramené juste en dessous.
- **Une piste par fichier (.zip)** : un WAV par piste de batterie et par instrument de la mélodie qui joue, tous de la même longueur, pour les mixer dans un logiciel de studio.
  Les pistes sont rendues sans le compresseur général de l'appli (le mix, lui, le garde) ; un avertissement apparaît si l'une dépasse 0 dB (choisir alors 32 bits flottants).
- **MIDI (.mid)** : batterie sur le canal 10 (notes GM : grosse caisse 36, caisse claire 38, rim 37, charleston 42 et 46, ride 51, cloche 56, tom 45, claves 75), un canal par instrument de la mélodie
  avec son programme GM le plus proche. Force 100 = normal, accent plus fort, fantôme plus faible ; le swing et les décalages de pistes sont inscrits dans les temps, l'humanisation non.
- Les exports sont limités à 10 minutes. Sur un téléphone, évitez les très longs exports en pistes séparées (la mémoire est comptée).

## Utilisation

- Une case = un pas. Clic (ou doigt) pour poser/retirer ; glisser le long d'une ligne pour peindre.
- Mélodie : des cases voisines d'un même instrument sur une même ligne forment une seule note tenue.
- Clic sur le nom d'une piste ou d'une note : on l'entend.
- M = couper la piste, S = l'écouter seule. Barre d'espace = jouer/arrêter.
- Réglages (style, tempo, tap tempo, subdivision, swing, volumes) : colonne de gauche ;
  sur téléphone, bandeau « Réglages » à déplier.
- Tout est enregistré automatiquement dans le navigateur (le motif reste au prochain lancement).

## Annuler / refaire, projets, export / import

- **Annuler ↶ / Refaire ↷** (en haut à gauche) : ⌘Z ou Ctrl+Z pour annuler, ⇧⌘Z, Ctrl+Maj+Z ou Ctrl+Y pour refaire. Cela couvre tout : cases, réglages de pas, tempo,
  volumes, gamme, mélange, sons édités, ouverture d'un projet… Les gestes rapprochés (glisser un curseur, peindre plusieurs cases) ne font qu'une étape ;
  80 étapes sont gardées, le temps de la session (elles s'effacent en rechargeant la page). L'instrument choisi dans la palette n'est pas une étape.
- **Projets** (bouton disquette) : enregistrer le projet en cours sous un nom, le rouvrir, le renommer, le supprimer. Ils sont gardés dans le navigateur.
  Ouvrir un projet remplace le projet en cours, mais c'est une étape comme une autre : « Annuler » le ramène.
- **Exporter ce projet** : télécharge un fichier `.sequenceur.json` (à garder, envoyer, ouvrir sur un autre appareil). **Importer un fichier…** le rouvre
  (là encore, « Annuler » revient en arrière). **Exporter tous les projets** fait une seule sauvegarde de la liste ; l'importer ajoute ses projets à la liste.
- **Nouveau projet** : grilles vides (les 8 patterns) et chanson vide ; les sons (patchs des instruments) et l'humanisation sont conservés.

## Contenu

```
index.html              la page
sw.js                   mémoire hors ligne (doit rester à côté de index.html)
manifest.webmanifest    installation sur l'écran d'accueil
app/
  sequencer.js          la grille, la lecture, les réglages
  audio-engine.js       le son (batterie synthétisée, échantillons, synthé, notes FM) et la liste des instruments (TIMBRES) ; SeqAudio.create() en fabrique d'autres moteurs, pour l'export
  editor.js             l'éditeur de son (fenêtre « Éditer le son »)
  projects.js           la fenêtre « Projets » (enregistrer, rouvrir, exporter, importer)
  export.js             la fenêtre « Exporter » : rendu WAV hors ligne, pistes séparées (.zip), fichier MIDI (+ export.test.js : « node app/export.test.js »)
  theory.js             gammes et noms de notes (+ theory.test.js : « node app/theory.test.js »)
  style.css             la mise en forme
  offline.js            enregistrement du mode hors ligne
  keepalive.js          iPhone : son en mode silencieux, écran toujours allumé
  audio/                synthés de batterie, moteur FM (fm-synth.js, avec fm-synth.test.js : « node app/fm-synth.test.js »),
                        catalogue des sons de chaque instrument (sound-lib.js, avec sound-lib.test.js), synthé soustractif (synth-voices.js),
                        chargement local des sons
  sounds/               piano, trompette, basse électrique (FluidR3_GM) et Bank/ : 23 échantillons légers de la banque TimGM6mb (environ 17 Mo en tout)
  vendor/, fonts/, icons/, licenses/
```

Si vous ajoutez ou enlevez un fichier, mettez à jour la liste `SHELL_FILES` dans `sw.js`.

### Ajouter un instrument ou un son

- **Un son de plus pour un instrument** : une entrée dans la liste `VOICES` de `app/audio/sound-lib.js` (nom, sorte `bank`, `sf` ou `synth`, réglages de départ).
  Pour un synthé, on y décrit forme d'onde, voix, filtre et enveloppe (`syn`) ; pour un échantillon, le nom du fichier de `app/sounds/Bank/`.
- **Un instrument de plus** : une ligne dans `TIMBRES` de `app/audio-engine.js` (nom, couleur, décalage d'octaves), son entrée dans `VOICES`,
  puis `node app/sound-lib.test.js` vérifie que tout est cohérent.
- **Échantillons** : un fichier `app/sounds/Bank/<nom>-<ton>.js` par note de référence (une note tous les 3 demi-tons suffit),
  à inscrire dans `LOCAL_BANK_NAMES` (`app/audio/local-soundfonts.js`) ; le mode hors ligne les récupère alors tout seul.
- **Piano, basse, trompette** : fichiers MIDI.js (FluidR3_GM) dans `app/sounds/FluidR3_GM/`, listés dans `LOCAL_SOUNDFONT_INSTRUMENTS`.

## Licences

Police Kalam (SIL OFL), échantillons MIDI.js Soundfonts (FluidR3_GM, MusyngKite) et
soundfont-player : voir le dossier `app/licenses/`.

**Attention, licence GPL-2** : les échantillons du dossier `app/sounds/Bank/` sont des notes enregistrées à partir de la banque de sons
**TimGM6mb** (Tim Brechbill, repris par David Bolton), publiée sous licence GNU GPL version 2 (texte dans `app/licenses/TimGM6mb-GPL2.txt`).
Si vous diffusez l'appli publiquement (GitHub Pages…), gardez ce fichier de licence avec les sons et indiquez la provenance.
Si vous préférez éviter la GPL, supprimez le dossier `Bank/` et les entrées correspondantes de `VOICES` : les instruments retombent alors sur le synthé.
