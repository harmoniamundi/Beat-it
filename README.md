# Séquenceur pas à pas

Un séquenceur de batterie et de mélodie, dans le même esprit que Chord Scales :
9 pistes de batterie, une piste mélodique (gamme, fondamentale et timbre au choix),
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

## Utilisation

- Une case = un pas. Clic (ou doigt) pour poser/retirer ; glisser le long d'une ligne pour peindre.
- Mélodie : des cases voisines sur une même ligne forment une seule note tenue.
- Clic sur le nom d'une piste ou d'une note : on l'entend.
- M = couper la piste, S = l'écouter seule. Barre d'espace = jouer/arrêter.
- Réglages (tempo, tap tempo, subdivision, swing, volumes) : colonne de gauche ;
  sur téléphone, bandeau « Réglages » à déplier.
- Tout est enregistré automatiquement dans le navigateur (le motif reste au prochain lancement).

## Contenu

```
index.html              la page
sw.js                   mémoire hors ligne (doit rester à côté de index.html)
manifest.webmanifest    installation sur l'écran d'accueil
app/
  sequencer.js          la grille, la lecture, les réglages
  audio-engine.js       le son (batterie synthétisée + instruments échantillonnés)
  theory.js             gammes et noms de notes (+ theory.test.js : « node app/theory.test.js »)
  style.css             la mise en forme
  offline.js            enregistrement du mode hors ligne
  audio/                synthés de batterie, chargement local des sons
  sounds/               piano, trompette, basse électrique (environ 8 Mo)
  vendor/, fonts/, icons/, licenses/
```

Si vous ajoutez ou enlevez un fichier, mettez à jour la liste `SHELL_FILES` dans `sw.js`.

## Licences

Police Kalam (SIL OFL), échantillons MIDI.js Soundfonts (FluidR3_GM, MusyngKite) et
soundfont-player : voir le dossier `app/licenses/`.
