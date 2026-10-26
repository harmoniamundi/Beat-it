// sound-lib.js — la bibliothèque de sons de la mélodie : pour chaque instrument (« emplacement »), la liste des sons
// qu'on peut lui donner, et la façon de les décrire, de les nettoyer et de les convertir en secondes, en Hz, etc.
// Aucun accès au DOM ni à l'audio : c'est utilisé par audio-engine.js (pour jouer), editor.js (pour régler) et sequencer.js
// (pour sauvegarder). Testé par sound-lib.test.js.
//
// Un « son » (ce qu'on enregistre dans un projet, pour chaque instrument) :
//   { v: 2, voice: <identifiant du son>, out: {réglages communs}, syn?: {réglages du synthé}, fm?: {patch FM} }
//   - voice : un son de la liste de l'instrument (ex. « nylon »), ou « fm » (synthé FM à 6 opérateurs, mode avancé).
//   - out   : curseurs de l'éditeur (attaque, relâchement, brillance, vibrato, chorus, écho, réverbération, volume…).
//   - syn   : seulement pour les sons « synthé » (forme d'onde, voix superposées, filtre…).
//   - fm    : seulement pour « fm » (voir fm-synth.js).
// Les sons sont de quatre sortes (kind) :
//   sf    échantillons soundfont-player (piano, basse, trompette), fichiers dans app/sounds/<banque>/
//   bank  échantillons maison, une note tous les 3 demi-tons, fichiers dans app/sounds/Bank/ (voir audio-engine.js)
//   synth synthé soustractif calculé en direct par le navigateur (oscillateurs → filtre → enveloppe)
//   fm    patch FM à 6 opérateurs, calculé note par note (fm-synth.js)

const SoundLib = (() => {
    'use strict';
    const FM = (typeof FMSynth !== 'undefined') ? FMSynth : require('./fm-synth.js').FMSynth;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const int = (v, a, b, d) => (Number.isFinite(v) ? clamp(Math.round(v), a, b) : d);

    /* ---------- Réglages communs (curseurs de l'éditeur) : [min, max, valeur de départ] ---------- */
    const OUT = {
        cut: [0, 127, 127],     // brillance : filtre passe-bas (127 = tout ouvert)
        res: [0, 99, 0],        // résonance du filtre
        drv: [0, 99, 0],        // grain : saturation
        att: [0, 99, 0],        // attaque
        rel: [0, 99, 30],       // relâchement
        vib: [0, 99, 0],        // profondeur du vibrato
        vrt: [0, 99, 50],       // vitesse du vibrato
        cho: [0, 99, 0],        // chorus (épaisseur)
        dtime: [0, 99, 15],     // écho : durée
        dfb: [0, 99, 40],       // écho : répétitions
        dmix: [0, 99, 0],       // écho : quantité
        rev: [0, 99, 20],       // réverbération
        tune: [-99, 99, 0],     // accord fin, en centièmes de ton
        pan: [0, 127, 64],      // panoramique (64 = centre)
        vol: [0, 127, 127]      // volume de l'instrument
    };
    const OUT_KEYS = Object.keys(OUT);
    // Réglages « de caractère » : un nouveau son les remplace par les siens ; volume, panoramique et accord restent.
    const KEEP_ON_VOICE = { tune: 1, pan: 1, vol: 1 };

    /* ---------- Réglages du synthé soustractif ---------- */
    const WAVES = [['saw', 'Dent de scie'], ['square', 'Carré'], ['pulse', 'Impulsion'], ['tri', 'Triangle'], ['sine', 'Sinus']];
    const SYN = {
        pw: [5, 50, 25],        // largeur de l'impulsion (%), pour « Impulsion »
        uni: [1, 5, 1],         // voix superposées
        det: [0, 60, 12],       // désaccord entre ces voix (centièmes de ton, de part et d'autre)
        sub: [0, 99, 0],        // sous-octave
        fc: [0, 99, 60],        // coupure du filtre, suit la note (plus haut = plus ouvert)
        q: [0, 99, 10],         // résonance du filtre
        fenv: [0, 99, 0],       // à quel point le filtre s'ouvre au début de chaque note
        fdec: [0, 99, 40],      // durée de cette ouverture
        dec: [0, 99, 50],       // durée de la descente vers le niveau de maintien
        sus: [0, 99, 99]        // niveau de maintien
    };
    const SYN_KEYS = Object.keys(SYN);

    /* ---------- Conversions curseur → unité ---------- */
    const attSec = (v) => 0.002 * Math.pow(1200, v / 99);                 // 2 ms … 2,4 s
    const relSec = (v) => 0.02 * Math.pow(200, v / 99);                   // 20 ms … 4 s
    const decSec = (v) => 0.03 * Math.pow(100, v / 99);                   // 30 ms … 3 s
    const cutHz = (c) => (c >= 127 ? 20000 : 30 * Math.pow(20000 / 30, c / 127));
    const vibCents = (v) => v / 99 * 60;                                  // profondeur : 0 … 60 centièmes de ton
    const vibHz = (v) => 3 + v / 99 * 5.5;                                // vitesse : 3 … 8,5 Hz
    const echoSec = (v) => 0.02 + 0.88 * Math.pow(v / 99, 1.5);           // 20 ms … 0,9 s
    // Inverses (anciennes sauvegardes : on retrouve le curseur d'après des secondes)
    const sliderOf = (fn, sec) => { let best = 0, e = Infinity; for (let v = 0; v <= 99; v++) { const d = Math.abs(fn(v) - sec); if (d < e) { e = d; best = v; } } return best; };

    /* ---------- Les sons de chaque instrument ---------- */
    // Pour chaque son : id, label ; kind ; out = réglages de départ qui le caractérisent ; hold = durée minimale (s) d'une note
    // (touches frappées : elles sonnent même si la case est courte) ; lvl = niveau (synthés) ; syn = réglages du synthé.
    const S = (id, label, out, syn, extra) => Object.assign({ id, label, kind: 'synth', out: out || {}, syn: syn || {} }, extra || {});
    const B = (id, label, file, out, extra) => Object.assign({ id, label, kind: 'bank', file, out: out || {} }, extra || {});
    const VOICES = {
        piano: [{ id: 'piano', label: 'Piano', kind: 'sf', sf: 'acoustic_grand_piano', bank: 'FluidR3_GM', out: { att: 22, rel: 51, rev: 20 } }],
        organ: [
            B('drawbar', 'Drawbar', 'organ_drawbar', { att: 8, rel: 22, cho: 30, rev: 25 }),
            B('rock', 'Rock', 'organ_rock', { att: 8, rel: 22, cho: 20, rev: 20 }),
            B('church', 'Église', 'organ_church', { att: 14, rel: 40, rev: 55 })
        ],
        guitar: [
            B('nylon', 'Nylon', 'guitar_nylon', { att: 4, rel: 44, rev: 22 }, { hold: 0.5 }),
            B('steel', 'Acier', 'guitar_steel', { att: 4, rel: 44, rev: 22 }, { hold: 0.5 }),
            B('clean', 'Électrique clair', 'guitar_clean', { att: 4, rel: 44, cho: 25, rev: 28 }, { hold: 0.5 })
        ],
        strings: [
            B('ensemble', 'Ensemble', 'strings_ens', { att: 62, rel: 56, cho: 30, rev: 38 }),
            B('violin', 'Violon', 'strings_violin', { att: 50, rel: 48, vib: 28, rev: 34 }),
            B('cello', 'Violoncelle', 'strings_cello', { att: 52, rel: 50, vib: 24, rev: 34 }),
            B('pizz', 'Pizzicato', 'strings_pizz', { att: 2, rel: 40, rev: 26 }, { hold: 0.4 })
        ],
        bass: [{ id: 'bass', label: 'Basse', kind: 'sf', sf: 'electric_bass_finger', bank: 'FluidR3_GM', out: { att: 22, rel: 51, rev: 20 } }],
        synthbass: [
            S('round', 'Ronde', { att: 6, rel: 34, rev: 8 }, { wave: 'saw', uni: 1, sub: 55, fc: 22, q: 22, fenv: 45, fdec: 30, dec: 38, sus: 70 }, { lvl: 0.0897 }),
            S('acid', 'Acide', { att: 4, rel: 28, rev: 8 }, { wave: 'saw', uni: 1, sub: 0, fc: 18, q: 72, fenv: 78, fdec: 26, dec: 32, sus: 45 }, { lvl: 0.13 }),
            S('sub', 'Sub', { att: 8, rel: 36, rev: 4 }, { wave: 'tri', uni: 1, sub: 70, fc: 40, q: 4, fenv: 15, fdec: 30, dec: 40, sus: 85 }, { lvl: 0.0683 })
        ],
        trumpet: [{ id: 'trumpet', label: 'Trompette', kind: 'sf', sf: 'trumpet', bank: 'MusyngKite', out: { att: 22, rel: 51, rev: 20 } }],
        flute: [
            B('flute', 'Flûte', 'flute', { att: 40, rel: 36, vib: 28, rev: 28 }),
            B('pan', 'Flûte de pan', 'flute_pan', { att: 38, rel: 36, vib: 12, rev: 30 }),
            B('recorder', 'Flûte à bec', 'flute_rec', { att: 30, rel: 32, rev: 26 })
        ],
        clarinet: [
            B('clarinet', 'Clarinette', 'clarinet', { att: 30, rel: 32, rev: 22 }),
            B('oboe', 'Hautbois', 'oboe', { att: 30, rel: 32, vib: 10, rev: 24 })
        ],
        marimba: [
            B('marimba', 'Marimba', 'marimba', { att: 0, rel: 40, rev: 26 }, { hold: 0.9 }),
            B('xylophone', 'Xylophone', 'xylophone', { att: 0, rel: 34, rev: 26 }, { hold: 0.7 })
        ],
        vibes: [
            B('vibes', 'Vibraphone', 'vibes', { att: 0, rel: 56, rev: 36 }, { hold: 1.6 }),
            B('celesta', 'Célesta', 'celesta', { att: 0, rel: 52, rev: 38 }, { hold: 1.4 })
        ],
        bells: [
            B('tubular', 'Cloches tubulaires', 'bells_tubular', { att: 0, rel: 62, rev: 42 }, { hold: 2.4 }),
            B('glock', 'Glockenspiel', 'glockenspiel', { att: 0, rel: 52, rev: 38 }, { hold: 1.8 }),
            B('musicbox', 'Boîte à musique', 'musicbox', { att: 0, rel: 52, rev: 38 }, { hold: 1.8 })
        ],
        synth: [
            S('saw', 'Lead dent de scie', { att: 6, rel: 34, cho: 30, rev: 24 }, { wave: 'saw', uni: 3, det: 14, sub: 0, fc: 56, q: 14, fenv: 32, fdec: 40, dec: 48, sus: 85 }, { lvl: 0.0872 }),
            S('square', 'Lead carré', { att: 6, rel: 30, cho: 20, rev: 22 }, { wave: 'square', uni: 2, det: 8, sub: 0, fc: 46, q: 10, fenv: 25, fdec: 36, dec: 48, sus: 85 }, { lvl: 0.0524 }),
            S('pluck', 'Pincé', { att: 2, rel: 34, rev: 26 }, { wave: 'saw', uni: 2, det: 10, sub: 0, fc: 20, q: 24, fenv: 70, fdec: 24, dec: 26, sus: 0 }, { lvl: 0.238, hold: 0.25 }),
            S('soft', 'Doux', { att: 28, rel: 44, vib: 14, cho: 35, rev: 34 }, { wave: 'tri', uni: 2, det: 9, sub: 20, fc: 70, q: 2, fenv: 0, fdec: 40, dec: 50, sus: 90 }, { lvl: 0.071 })
        ],
        chip: [
            S('pulse50', 'Carré 50 %', { att: 0, rel: 14, vib: 16, rev: 10 }, { wave: 'square', uni: 1, sub: 0, fc: 99, q: 0, fenv: 0, fdec: 30, dec: 36, sus: 70 }, { lvl: 0.0643 }),
            S('pulse25', 'Impulsion 25 %', { att: 0, rel: 14, vib: 16, rev: 10 }, { wave: 'pulse', pw: 25, uni: 1, sub: 0, fc: 99, q: 0, fenv: 0, fdec: 30, dec: 36, sus: 70 }, { lvl: 0.1058 }),
            S('pulse12', 'Impulsion 12 %', { att: 0, rel: 14, vib: 16, rev: 10 }, { wave: 'pulse', pw: 12, uni: 1, sub: 0, fc: 99, q: 0, fenv: 0, fdec: 30, dec: 36, sus: 70 }, { lvl: 0.1635 }),
            S('tri', 'Triangle', { att: 0, rel: 14, rev: 10 }, { wave: 'tri', uni: 1, sub: 0, fc: 99, q: 0, fenv: 0, fdec: 30, dec: 36, sus: 99 }, { lvl: 0.076 })
        ],
        pad: [
            S('warm', 'Chaude', { att: 70, rel: 70, cho: 52, rev: 52 }, { wave: 'saw', uni: 5, det: 24, sub: 0, fc: 34, q: 8, fenv: 0, fdec: 40, dec: 50, sus: 99 }, { lvl: 0.0694 }),
            S('air', 'Aérienne', { att: 78, rel: 76, vib: 10, cho: 60, rev: 62 }, { wave: 'tri', uni: 4, det: 30, sub: 0, fc: 52, q: 6, fenv: 0, fdec: 40, dec: 50, sus: 99 }, { lvl: 0.0627 }),
            B('choir', 'Chœur', 'choir', { att: 60, rel: 64, cho: 30, rev: 50 })
        ]
    };
    // Instruments dont le patch FM d'usine existe encore (ils peuvent passer en mode « fm »)
    const FM_VOICE = { id: 'fm', label: 'Synthé FM', kind: 'fm', out: { att: 0, rel: 30, rev: 20 } };
    const hasFm = (slot) => !!(FM.FACTORY && FM.FACTORY[slot]);

    const slots = () => Object.keys(VOICES);
    const voiceList = (slot) => (VOICES[slot] || []).concat(hasFm(slot) ? [FM_VOICE] : []);
    const defaultVoiceId = (slot) => (VOICES[slot] && VOICES[slot][0].id) || 'fm';
    function voice(slot, id) {
        const l = voiceList(slot);
        return l.find((v) => v.id === id) || l[0];
    }

    /* ---------- Nettoyage ---------- */
    function cleanOut(o, base) {
        const d = {};
        OUT_KEYS.forEach((k) => { d[k] = int(o && o[k], OUT[k][0], OUT[k][1], base && base[k] != null ? base[k] : OUT[k][2]); });
        return d;
    }
    function outOf(v, keep) {
        const o = {};
        OUT_KEYS.forEach((k) => { o[k] = KEEP_ON_VOICE[k] && keep && keep[k] != null ? keep[k] : (v.out && v.out[k] != null ? v.out[k] : OUT[k][2]); });
        return o;
    }
    function cleanSyn(s, base) {
        const d = {};
        d.wave = WAVES.some((w) => w[0] === (s && s.wave)) ? s.wave : (base && base.wave) || 'saw';
        SYN_KEYS.forEach((k) => { d[k] = int(s && s[k], SYN[k][0], SYN[k][1], base && base[k] != null ? base[k] : SYN[k][2]); });
        return d;
    }
    const synOf = (v) => cleanSyn(v.syn, null);

    // Son de départ d'un instrument
    function defaultSound(slot) { return withVoice(slot, null, defaultVoiceId(slot)); }

    // Donne à un instrument un nouveau son ; volume, panoramique et accord de l'ancien sont gardés.
    function withVoice(slot, prev, id) {
        const v = voice(slot, id);
        const s = { v: 2, voice: v.id, out: outOf(v, prev && prev.out) };
        if (v.kind === 'synth') s.syn = synOf(v);
        if (v.kind === 'fm') s.fm = FM.clone(FM.FACTORY[slot] || FM.initPatch());
        return s;
    }

    const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // Une sauvegarde de l'ancienne version (patch FM d'usine ou enveloppe d'échantillon) : on prend le nouveau son
    // de l'instrument, mais un patch FM que vous aviez modifié est conservé (mode « fm »).
    const OLD_OUT = { cut: 127, res: 0, drv: 0, dtime: 15, dfb: 40, dmix: 0, tune: 0, pan: 64, vol: 127 };
    function migrate(slot, raw) {
        const s = defaultSound(slot);
        const o = raw.out && typeof raw.out === 'object' ? raw.out : {};
        Object.keys(OLD_OUT).forEach((k) => {
            if (Number.isFinite(o[k]) && o[k] !== OLD_OUT[k]) s.out[k] = int(o[k], OUT[k][0], OUT[k][1], s.out[k]);
        });
        if (raw.fm && hasFm(slot)) {
            const p = FM.cleanPatch(raw.fm);
            if (!sameJson(p, FM.FACTORY[slot])) { s.voice = 'fm'; s.fm = p; }
        }
        if (Array.isArray(raw.env) && voice(slot, s.voice).kind === 'sf') {          // enveloppe des échantillons : attaque et relâchement
            const e = FM.cleanEnv(raw.env);
            if (e[0] > 0) s.out.att = sliderOf(attSec, e[0]);
            if (e[3] > 0) s.out.rel = sliderOf(relSec, e[3]);
        }
        return s;
    }

    // Remet n'importe quel objet (sauvegarde, fichier importé…) en son complet et valide
    function cleanSound(slot, raw) {
        if (!raw || typeof raw !== 'object') return defaultSound(slot);
        if (raw.v !== 2) return migrate(slot, raw);
        const v = voice(slot, raw.voice), base = withVoice(slot, null, v.id);
        const s = { v: 2, voice: v.id, out: cleanOut(raw.out, base.out) };
        if (v.kind === 'synth') s.syn = cleanSyn(raw.syn, base.syn);
        if (v.kind === 'fm') s.fm = raw.fm ? FM.cleanPatch(raw.fm) : base.fm;
        return s;
    }

    // Ce que l'éditeur propose pour chaque sorte de son : curseurs utiles (les autres sont masqués)
    const HIDE = {
        sf: { vib: 1, vrt: 1 },
        bank: {},
        synth: {},
        fm: { att: 1, rel: 1 }
    };
    const applies = (kind, key) => !(HIDE[kind] && HIDE[kind][key]);

    // Les fichiers d'échantillons « maison » nécessaires (service worker, tests)
    const BANK_DIR = 'app/sounds/Bank';
    const bankFiles = () => {
        const out = [];
        slots().forEach((slot) => VOICES[slot].forEach((v) => { if (v.kind === 'bank') out.push(v.file); }));
        return out;
    };
    const bankUrl = (file) => BANK_DIR + '/' + file + '.js';

    return {
        OUT, OUT_KEYS, SYN, SYN_KEYS, WAVES, VOICES, FM_VOICE,
        slots, voiceList, voice, defaultVoiceId, defaultSound, withVoice, cleanSound, cleanOut, cleanSyn, applies, hasFm,
        attSec, relSec, decSec, cutHz, vibCents, vibHz, echoSec, sliderOf, bankFiles, bankUrl, BANK_DIR
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SoundLib };
}
