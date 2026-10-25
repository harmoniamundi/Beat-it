// local-soundfonts.js — les échantillons des instruments (piano, basses, cuivres, etc.) sont servis par le site lui-même,
// depuis le dossier app/sounds/, et non plus par un serveur externe : c'est ce qui permet de jouer hors ligne.
// Chargé par index.html juste après soundfont-player, avant le script principal.
// Le service worker (sw.js) charge aussi ce fichier (importScripts) pour connaître la liste des sons à garder en cache.
//
// Deux façons de lire un fichier de son, selon la façon dont la page est ouverte :
//  - depuis un site (https://… ou http://localhost) : soundfont-player le télécharge lui-même (XMLHttpRequest) ;
//  - par double-clic sur index.html (adresse file://) : les navigateurs interdisent XMLHttpRequest sur un fichier
//    local, donc le fichier de son est chargé comme un <script> (autorisé), qui dépose ses échantillons dans
//    MIDI.Soundfont[nom] ; on les rend alors à soundfont-player sous forme de promesse.

const LOCAL_SOUNDFONT_DIR = 'app/sounds';

// Même règle de nommage que soundfont-player (« <banque>/<instrument>-mp3.js »), mais vers notre dossier.
// Banque par défaut de la bibliothèque : MusyngKite.
function localSoundfontUrl(name, soundfont, format) {
    const bank = soundfont === 'FluidR3_GM' ? 'FluidR3_GM' : 'MusyngKite';
    const fmt = format === 'ogg' ? 'ogg' : 'mp3';
    return LOCAL_SOUNDFONT_DIR + '/' + bank + '/' + name + '-' + fmt + '.js';
}

// Instruments réellement demandés par l'appli (banque, nom). Si on ajoute un timbre dans audio-engine.js, on l'ajoute ici
// ET on copie son fichier dans app/sounds/.
const LOCAL_SOUNDFONT_INSTRUMENTS = [
    ['FluidR3_GM', 'acoustic_grand_piano'],
    ['FluidR3_GM', 'electric_bass_finger'],
    ['MusyngKite', 'trumpet']
];
const LOCAL_SOUNDFONT_FILES = LOCAL_SOUNDFONT_INSTRUMENTS.map(([bank, name]) => localSoundfontUrl(name, bank, 'mp3'));

// Page ouverte par double-clic (file://) ? Les navigateurs y interdisent la lecture de fichiers par XMLHttpRequest.
function isFileProtocol() {
    return typeof location !== 'undefined' && location.protocol === 'file:';
}

// Charge un fichier de son comme <script> et renvoie ses échantillons ({ 'A0': 'data:audio/mp3;base64,…', … }).
// Une demande déjà en cours pour la même adresse est partagée (le piano est demandé deux fois au démarrage).
const pendingSoundfontScripts = new Map();
function loadSoundfontViaScript(url, name) {
    if (pendingSoundfontScripts.has(url)) return pendingSoundfontScripts.get(url);
    const promise = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.async = true;
        el.onload = () => {
            const bank = window.MIDI && window.MIDI.Soundfont && window.MIDI.Soundfont[name];
            if (window.MIDI && window.MIDI.Soundfont) delete window.MIDI.Soundfont[name]; // soundfont-player garde les échantillons : inutile de les garder deux fois
            el.remove();
            if (bank) resolve(bank); else reject(new Error('Fichier de son vide : ' + url));
        };
        el.onerror = () => { el.remove(); reject(new Error('Fichier de son introuvable : ' + url)); };
        el.src = url;
        document.head.appendChild(el);
    });
    pendingSoundfontScripts.set(url, promise);
    const forget = () => pendingSoundfontScripts.delete(url);
    promise.then(forget, forget);
    return promise;
}

// Même signature que localSoundfontUrl, mais renvoie une promesse d'échantillons (acceptée par soundfont-player
// à la place d'une adresse).
function localSoundfontViaScript(name, soundfont, format) {
    return loadSoundfontViaScript(localSoundfontUrl(name, soundfont, format), name);
}

// Fait passer tous les appels Soundfont.instrument(...) par nos fichiers locaux. Une option nameToUrl passée
// explicitement garde la priorité. Sans effet si la bibliothèque est absente ou déjà configurée.
// `viaScript` : forcer (true / false) le chargement par <script> ; par défaut, seulement quand la page est en file://.
function useLocalSoundfonts(sf, viaScript) {
    if (!sf || typeof sf.instrument !== 'function' || sf.__localSoundfonts) return sf;
    const original = sf.instrument;
    const nameToUrl = (viaScript === undefined ? isFileProtocol() : viaScript) ? localSoundfontViaScript : localSoundfontUrl;
    sf.instrument = function (ctx, name, opts) {
        return original.call(sf, ctx, name, Object.assign({ nameToUrl }, opts || {}));
    };
    sf.__localSoundfonts = true;
    return sf;
}

if (typeof Soundfont !== 'undefined') useLocalSoundfonts(Soundfont);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LOCAL_SOUNDFONT_DIR,
        LOCAL_SOUNDFONT_INSTRUMENTS,
        LOCAL_SOUNDFONT_FILES,
        localSoundfontUrl,
        localSoundfontViaScript,
        loadSoundfontViaScript,
        isFileProtocol,
        useLocalSoundfonts
    };
}
