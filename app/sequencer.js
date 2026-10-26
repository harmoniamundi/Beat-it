// sequencer.js — état, grilles, lecture et événements du Séquenceur pas à pas.
// Une mesure à 4 temps qui tourne en boucle : la batterie (9 pistes) et une mélodie (grille note × pas, sur la
// gamme choisie ; chaque case porte son instrument). Le son est dans audio-engine.js, les gammes dans theory.js.

(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAXSTEPS = 16, MAXROWS = 25;      // 25 lignes : la gamme chromatique sur 2 octaves (12 × 2 + 1)
const KEY = 'sequenceur-pas-a-pas-v2';

/* ---------- Données ---------- */
const DRUMS = [
    { id: 'kick',  drum: 'kick',  name: 'Grosse caisse',  fam: 'body'  },
    { id: 'snare', drum: 'snare', name: 'Caisse claire',  fam: 'body'  },
    { id: 'rim',   drum: 'rim',   name: 'Rim',            fam: 'body'  },
    { id: 'hat',   drum: 'hat',   name: 'Charley fermé',  fam: 'metal' },
    { id: 'ohat',  drum: 'ohat',  name: 'Charley ouvert', fam: 'metal' },
    { id: 'ride',  drum: 'ride',  name: 'Ride',           fam: 'metal' },
    { id: 'bell',  drum: 'bell',  name: 'Cloche',         fam: 'metal' },
    { id: 'tom',   drum: 'tom2',  name: 'Tom',            fam: 'skin'  },
    { id: 'clave', drum: 'clave', name: 'Claves',         fam: 'skin'  }
];

// Pistes : les 9 de la batterie + la mélodie (une seule piste, toutes ses notes ensemble)
const MEL = 'mel';
const LANES = DRUMS.map(d => d.id).concat(MEL);

// Sens de lecture d'une piste
const DIRS = [
    ['fwd', '→', 'Avant'],
    ['bwd', '←', 'Arrière'],
    ['pp',  '↔', 'Aller-retour'],
    ['rnd', '?', 'Aléatoire']
];
const dirSym = id => (DIRS.find(d => d[0] === id) || DIRS[0])[1];
// Conditions « A:B » : le pas ne joue qu'au tour A de chaque série de B tours de la boucle de sa piste
const CONDS = ['', '1:2', '2:2', '1:3', '2:3', '3:3', '1:4', '2:4', '3:4', '4:4', '1:8', '8:8'];
const RATS = [1, 2, 3, 4, 6, 8];
// Réglages d'un pas ; seules les valeurs différentes de la valeur par défaut sont gardées
//   prob : chance de jouer (%) · cond/inv : condition · rat : répétitions · vol, flt (filtre, 100 = ouvert), pan, rev : verrous · oct : octave (mélodie)
const EXT_SPEC = { prob: [0, 100, 100], vol: [0, 100, 100], flt: [0, 100, 100], pan: [-100, 100, 0], rev: [0, 100, 0] };

const DIVS = [
    [8,  'Croches',  '2 par temps', 'Croches'],
    [12, 'Triolets', '3 par temps', 'Triolets de croches'],
    [16, 'Doubles',  '4 par temps', 'Doubles-croches']
];

const E8 = [0, 2, 4, 6, 8, 10, 12, 14];
const ALL16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// « feel » : la façon dont « Au hasard » compose la mélodie dans ce style (voir randomMelody)
//   dens : densité générale (0–1) · first : chance d'une note sur le 1er pas · beat / off / weak : chance d'une note sur un temps,
//   sur un contretemps (le « + », ou le 3e pas d'un triolet) et sur les autres pas · lock : attirance vers les pas où la grosse caisse,
//   la caisse claire ou les instruments rythmiques de la batterie jouent · leap : saut maximal, en lignes de la grille
//   tie : chance de tenir la note sur le pas suivant · chord : poids des notes d'accord (1, 3, 5 de la gamme)
//   run : tendance à continuer dans le même sens (lignes en gammes) · again : tendance à répéter la même note
//   rep : longueur du motif en temps, ensuite répété jusqu'à la fin de la mesure (0 = pas de répétition)
const DEFAULT_FEEL = { dens: 1, first: 0.85, beat: 0.75, off: 0.4, weak: 0.1, lock: 0.3, leap: 2, tie: 0.2, chord: 2, run: 1.2, again: 0.5, rep: 0 };

const PRESETS = {
    rock:    { label: 'Rock',      bpm: 108, div: 16, swing: 0,  map: { kick: [0, 8, 10], snare: [4, 12], hat: E8 },
               feel: { beat: 0.8, off: 0.45, weak: 0.06, first: 0.9, lock: 0.4, tie: 0.2, run: 1, again: 1, rep: 2 } },
    punk:    { label: 'Punk',      bpm: 180, div: 16, swing: 0,  map: { kick: [0, 2, 8, 10], snare: [4, 12], hat: E8 },
               feel: { beat: 0.85, off: 0.6, weak: 0.03, first: 0.95, lock: 0.3, leap: 1, tie: 0.05, chord: 2.5, again: 1.6, rep: 2 } },
    disco:   { label: 'Disco',     bpm: 118, div: 16, swing: 0,  map: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], ohat: [2, 6, 10, 14] },
               feel: { beat: 0.5, off: 0.7, weak: 0.2, first: 0.8, lock: 0.25, leap: 3, tie: 0.1, chord: 2.5, run: 1.5, again: 0.8, rep: 2 } },
    house:   { label: 'House',     bpm: 124, div: 16, swing: 0,  map: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [1, 5, 9, 13], ohat: [2, 6, 10, 14] },
               feel: { beat: 0.45, off: 0.65, weak: 0.1, first: 0.8, lock: 0.2, leap: 3, tie: 0.15, chord: 3, again: 1.2, rep: 2 } },
    funk:    { label: 'Funk',      bpm: 100, div: 16, swing: 12, map: { kick: [0, 3, 6, 10], snare: [4, 12], hat: E8, ohat: [15] },
               feel: { beat: 0.5, off: 0.45, weak: 0.4, first: 0.7, lock: 0.5, leap: 3, tie: 0.03, chord: 1.5, again: 1.4, rep: 2 } },
    boombap: { label: 'Boom bap',  bpm: 90,  div: 16, swing: 30, map: { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], ohat: [14] },
               feel: { dens: 0.9, beat: 0.35, off: 0.15, weak: 0.12, first: 0.85, lock: 0.55, tie: 0.4, chord: 2.5 } },
    trap:    { label: 'Trap',      bpm: 140, div: 16, swing: 0,  map: { kick: [0, 6, 10], snare: [8], hat: ALL16, ohat: [14] },
               feel: { beat: 0.3, off: 0.15, weak: 0.2, first: 0.7, lock: 0.45, leap: 4, tie: 0.45, again: 0.7 } },
    dnb:     { label: 'Drum & bass', bpm: 172, div: 16, swing: 0, map: { kick: [0, 10], snare: [4, 12], hat: E8 },
               feel: { beat: 0.5, off: 0.45, weak: 0.3, lock: 0.45, leap: 3, tie: 0.2, run: 1.8, rep: 2 } },
    reggae:  { label: 'Reggae',    bpm: 76,  div: 16, swing: 10, map: { kick: [8], rim: [8], hat: E8 },
               feel: { beat: 0.1, off: 0.6, weak: 0.02, first: 0.15, lock: 0.15, tie: 0.1, chord: 3, again: 1.5, rep: 2 } },
    bossa:   { label: 'Bossa',     bpm: 118, div: 16, swing: 0,  map: { kick: [0, 6, 8, 14], rim: [0, 3, 6, 10, 13], hat: E8 },
               feel: { beat: 0.55, off: 0.5, weak: 0.12, lock: 0.35, tie: 0.3, chord: 2.5, run: 1.6 } },
    salsa:   { label: 'Salsa (clave 3-2)', bpm: 170, div: 16, swing: 0, map: { clave: [0, 3, 6, 10, 12], bell: [0, 4, 8, 12], tom: [6, 10, 14], kick: [0, 8] },
               feel: { beat: 0.4, off: 0.5, weak: 0.3, lock: 0.6, tie: 0.1, again: 1.3, rep: 2 } },
    jazz:    { label: 'Jazz',      bpm: 132, div: 12, swing: 0,  map: { ride: [0, 3, 5, 6, 9, 11], hat: [3, 9], kick: [0, 6] },
               feel: { beat: 0.7, off: 0.6, weak: 0.06, first: 0.7, lock: 0.15, leap: 4, tie: 0.1, chord: 1.6, run: 2.2, again: 0.2 } },
    shuffle: { label: 'Shuffle blues', bpm: 100, div: 12, swing: 0, map: { kick: [0, 6], snare: [3, 9], hat: [0, 2, 3, 5, 6, 8, 9, 11] },
               feel: { beat: 0.7, off: 0.6, weak: 0.05, lock: 0.3, leap: 3, tie: 0.2, run: 1.3, again: 1, rep: 2 } },
    afro:    { label: 'Afro 12/8', bpm: 96,  div: 12, swing: 0,  map: { bell: [0, 2, 4, 5, 7, 9, 11], kick: [0, 6], tom: [3, 9] },
               feel: { beat: 0.55, off: 0.4, weak: 0.3, lock: 0.45, tie: 0.15, chord: 2.5, again: 0.9, rep: 2 } },
    ballad:  { label: 'Ballade 12/8', bpm: 66, div: 12, swing: 0, map: { kick: [0, 6], rim: [3], snare: [9], hat: [0, 3, 6, 9] },
               feel: { beat: 0.5, off: 0.15, weak: 0.15, first: 0.9, lock: 0.3, tie: 0.5, chord: 3, run: 1.4 } }
};

// Mélodie d'exemple : [pas, ligne] sur la gamme pentatonique mineure de Do (0 = Do, 1 = Mi♭, 2 = Fa, 3 = Sol, 4 = Si♭)
const DEFAULT_RIFF = [[0, 0], [3, 1], [4, 2], [6, 1], [8, 3], [10, 2], [11, 1], [12, 0], [14, 4], [15, 4]];

const mkPat = (map) => {
    const p = {};
    DRUMS.forEach(d => {
        const a = Array(MAXSTEPS).fill(0);
        (map[d.id] || []).forEach(i => { a[i] = 1; });
        p[d.id] = a;
    });
    return p;
};
const LAYERS = 3;      // un même degré peut porter jusqu'à 3 notes superposées (3 instruments) au même pas
const emptyMel = () => Array.from({ length: MAXROWS }, () => Array(MAXSTEPS).fill(0));
const emptyMelLayers = () => Array.from({ length: LAYERS }, () => emptyMel());
// Une case de la mélodie vaut 0 (vide) ou l'identifiant de son instrument ('piano', 'bass'…).
const mkMel = (notes, ins) => {
    const m = emptyMel();
    notes.forEach(([step, row]) => { m[row][step] = ins; });
    return m;
};

/* ---------- État ---------- */
const state = {
    bpm: PRESETS.rock.bpm, swing: 0, div: 16, preset: 'rock', style: 'rock',      // style : dernier style choisi (« Générer » le suit, même si le rythme a été modifié ensuite)
    pat: mkPat(PRESETS.rock.map), mute: {}, solo: {}, vol: {}, drumVol: 80, melVol: 70,
    mel: [mkMel(DEFAULT_RIFF, 'piano'), emptyMel(), emptyMel()],       // couches de grilles [couche][degré][pas] ; la couche 0 est la ligne principale
    root: 'C', scale: 'pentMin', octave: 4, range: 1,
    timbre: 'piano',          // instrument des prochaines cases posées
    insOct: {},               // décalage d'octaves de chaque instrument (−3…+3)
    insVol: {},               // niveau de chaque instrument dans le mélange (0–150 %, 100 = niveau d'origine)
    snd: {},                  // son de chaque instrument : patch FM (ou enveloppe pour les échantillons) + réglages de sortie (éditeur de son)
    insMute: {},              // instrument coupé dans le mélange (bouton M)
    insSolo: {},              // instrument écouté seul (bouton S) ; plusieurs solos s'additionnent
    ext: {}, len: {}, dir: {}
};
Object.keys(SeqAudio.TIMBRES).forEach(k => { state.insOct[k] = SeqAudio.TIMBRES[k].shift; state.insVol[k] = 100; state.insMute[k] = false; state.insSolo[k] = false; state.snd[k] = FMSynth.defaultSound(k); });
DRUMS.forEach(d => { state.mute[d.id] = false; state.solo[d.id] = false; state.vol[d.id] = 80; });
LANES.forEach(id => { state.ext[id] = {}; state.len[id] = 0; state.dir[id] = 'fwd'; });

function cleanExt(o) {
    if (!o || typeof o !== 'object') return null;
    const e = {};
    Object.keys(EXT_SPEC).forEach(k => {
        const sp = EXT_SPEC[k];
        if (Number.isFinite(o[k])) { const v = clamp(Math.round(o[k]), sp[0], sp[1]); if (v !== sp[2]) e[k] = v; }
    });
    if (CONDS.indexOf(o.cond) > 0) { e.cond = o.cond; if (o.inv) e.inv = true; }
    if (RATS.indexOf(o.rat) > 0) e.rat = o.rat;
    if (o.oct === 1 || o.oct === -1) e.oct = o.oct;
    return Object.keys(e).length ? e : null;
}

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        if ([8, 12, 16].indexOf(s.div) !== -1) state.div = s.div;
        if (Number.isFinite(s.bpm)) state.bpm = clamp(Math.round(s.bpm), 40, 220);
        if (Number.isFinite(s.swing)) state.swing = clamp(Math.round(s.swing), 0, 100);
        state.preset = (typeof s.preset === 'string' && PRESETS[s.preset]) ? s.preset : '';
        state.style = PRESETS[s.style] ? s.style : (state.preset || 'rock');
        if (Number.isFinite(s.drumVol)) state.drumVol = clamp(Math.round(s.drumVol), 0, 100);
        if (Number.isFinite(s.melVol)) state.melVol = clamp(Math.round(s.melVol), 0, 100);
        DRUMS.forEach(d => {
            const a = s.pat && s.pat[d.id];
            if (Array.isArray(a)) state.pat[d.id] = Array.from({ length: MAXSTEPS }, (_, i) => (a[i] ? 1 : 0));
            if (s.vol && Number.isFinite(s.vol[d.id])) state.vol[d.id] = clamp(s.vol[d.id], 0, 100);
            state.mute[d.id] = !!(s.mute && s.mute[d.id]);
            state.solo[d.id] = !!(s.solo && s.solo[d.id]);
        });
        if (Theory.ROOTS.indexOf(s.root) !== -1) state.root = s.root;
        if (Theory.SCALES.some(sc => sc.id === s.scale)) state.scale = s.scale;
        if ([2, 3, 4, 5].indexOf(s.octave) !== -1) state.octave = s.octave;
        if ([1, 2].indexOf(s.range) !== -1) state.range = s.range;
        if (SeqAudio.TIMBRES[s.timbre]) state.timbre = s.timbre;
        if (s.insOct && typeof s.insOct === 'object') {
            Object.keys(state.insOct).forEach(k => { if (Number.isFinite(s.insOct[k])) state.insOct[k] = clamp(Math.round(s.insOct[k]), -3, 3); });
        }
        if (s.insVol && typeof s.insVol === 'object') {
            Object.keys(state.insVol).forEach(k => { if (Number.isFinite(s.insVol[k])) state.insVol[k] = clamp(Math.round(s.insVol[k]), 0, 150); });
        }
        if (s.snd && typeof s.snd === 'object') Object.keys(state.snd).forEach(k => { state.snd[k] = FMSynth.cleanSound(k, s.snd[k]); });
        ['insMute', 'insSolo'].forEach(f => {
            if (s[f] && typeof s[f] === 'object') Object.keys(state[f]).forEach(k => { state[f][k] = !!s[f][k]; });
        });
        if (Array.isArray(s.mel)) {
            // Les anciennes sauvegardes notent 1 pour une case allumée : elle prend l'instrument alors choisi (state.timbre).
            // Elles n'ont qu'une grille (degré × pas) : elle devient la couche 0.
            const cell = v => (typeof v === 'string' && SeqAudio.TIMBRES[v]) ? v : (v ? state.timbre : 0);
            const src = (Array.isArray(s.mel[0]) && Array.isArray(s.mel[0][0])) ? s.mel : [s.mel];
            state.mel = Array.from({ length: LAYERS }, (_, l) => Array.from({ length: MAXROWS }, (_, r) =>
                Array.from({ length: MAXSTEPS }, (_, i) => cell(src[l] && src[l][r] && src[l][r][i]))));
        }
        LANES.forEach(id => {
            if (s.len && Number.isFinite(s.len[id])) state.len[id] = clamp(Math.round(s.len[id]), 0, MAXSTEPS);
            if (s.dir && DIRS.some(d => d[0] === s.dir[id])) state.dir[id] = s.dir[id];
            const bag = s.ext && s.ext[id];
            if (bag && typeof bag === 'object') {
                Object.keys(bag).forEach(k => {
                    const i = +k, e = cleanExt(bag[k]);
                    if (i >= 0 && i < MAXSTEPS && e) state.ext[id][i] = e;
                });
            }
        });
    } catch (e) { /* stockage indisponible : on garde les valeurs d'origine */ }
}
let saveT = null;
function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignoré */ }
    }, 250);
}

const anySolo = () => DRUMS.some(d => state.solo[d.id]);
const audible = id => !state.mute[id] && (!anySolo() || state.solo[id]);

let rowsInfo = [];
function refreshRows() {
    rowsInfo = Theory.rows(state.root, state.scale, state.octave, state.range);
}

/* ---------- Horloge ---------- */
// Un Web Worker bat la mesure : les minuteries de la page sont ralenties quand l'onglet est en arrière-plan,
// celles d'un worker beaucoup moins. Sans worker, on retombe sur setInterval.
function makeClock(cb, ms) {
    try {
        const src = 'let t=null;onmessage=function(e){clearInterval(t);if(e.data==="start"){t=setInterval(function(){postMessage(0)},' + ms + ');}};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url);
        w.onmessage = () => cb();
        return { start() { w.postMessage('start'); }, stop() { w.postMessage('stop'); } };
    } catch (e) {
        let t = null;
        return { start() { clearInterval(t); t = setInterval(cb, ms); }, stop() { clearInterval(t); } };
    }
}

/* ---------- Lecture ---------- */
// `tick` compte les pas depuis le départ ; chaque piste en déduit sa propre position (longueur et sens à elle),
// d'où la polymétrie : une piste de 15 pas et une de 16 se décalent à chaque tour.
let playing = false, tick = 0, nextTime = 0, raf = 0;
const queue = [];
const stepDur = () => 60 / state.bpm / (state.div / 4);

const effLen = id => { const l = state.len[id]; return l > 0 ? Math.min(l, state.div) : state.div; };
const stepExt = (id, i) => state.ext[id][i] || null;

// Position de la piste au pas n : { idx : case jouée, cycle : nombre de tours de boucle déjà faits }
function lanePos(id, n) {
    const L = effLen(id), dir = state.dir[id];
    if (dir === 'bwd') return { idx: L - 1 - (n % L), cycle: Math.floor(n / L) };
    if (dir === 'pp' && L > 1) {
        const P = 2 * L - 2, m = n % P;
        return { idx: m < L ? m : P - m, cycle: Math.floor(n / P) };
    }
    if (dir === 'rnd') return { idx: Math.floor(Math.random() * L), cycle: Math.floor(n / L) };
    return { idx: n % L, cycle: Math.floor(n / L) };
}

// Le pas joue-t-il à ce tour ? (condition d'abord, puis le tirage au sort de la probabilité)
function passes(e, cycle) {
    if (!e) return true;
    if (e.cond) {
        const ab = e.cond.split(':'), a = +ab[0], b = +ab[1];
        let ok = (cycle % b) === a - 1;
        if (e.inv) ok = !ok;
        if (!ok) return false;
    }
    if (e.prob != null && e.prob < 100 && Math.random() * 100 >= e.prob) return false;
    return true;
}

function fxOf(e) {
    if (!e || (e.flt == null && !e.pan && !e.rev)) return null;
    return { flt: e.flt == null ? 100 : e.flt, pan: e.pan || 0, rev: e.rev || 0 };
}

function playDrumHit(dr, e, when, d) {
    const rat = (e && e.rat) || 1, vol = e && e.vol != null ? e.vol / 100 : 1, fx = fxOf(e);
    for (let k = 0; k < rat; k++) {
        SeqAudio.playDrum(dr.id, dr.drum, when + k * d / rat, 0.9 * vol * (k === 0 ? 1 : 0.78), fx);
    }
}

// Mute / solo des instruments de la mélodie. Seuls les instruments affichés dans le mélangeur comptent pour le solo :
// un solo laissé sur un instrument qui n'a plus aucune note ne rend donc pas le reste muet sans qu'on puisse le défaire.
let mixKeys = [];
const anyInsSolo = () => mixKeys.some(k => state.insSolo[k]);
const insAudible = k => !state.insMute[k] && (!anyInsSolo() || !!state.insSolo[k]);
function refreshInsAudible() {
    Object.keys(SeqAudio.TIMBRES).forEach(k => SeqAudio.setInstrumentAudible(k, insAudible(k)));
    insMixEl.querySelectorAll('.ins-row').forEach(row => {
        const k = row.dataset.ins;
        row.querySelector('.ms.m').setAttribute('aria-pressed', state.insMute[k] ? 'true' : 'false');
        row.querySelector('.ms.s').setAttribute('aria-pressed', state.insSolo[k] ? 'true' : 'false');
        row.classList.toggle('silent', !insAudible(k));
    });
}

const insGain = ins => (state.insVol[ins] == null ? 100 : state.insVol[ins]) / 100;     // niveau de l'instrument dans le mélange

// L'instrument `ins` joue-t-il sur le degré r au pas i (sur n'importe quelle couche) ?
const stackHas = (r, i, ins) => state.mel.some(grid => grid[r][i] === ins);

// Notes de la mélodie jouées au pas `s` ; renvoie vrai si au moins une note part.
function playMelodyStep(s, L, e, when, d) {
    const dir = state.dir[MEL], hold = dir === 'fwd' || dir === 'bwd', sgn = dir === 'bwd' ? -1 : 1;
    const rat = (e && e.rat) || 1, vol = e && e.vol != null ? e.vol / 100 : 1, fx = fxOf(e), shift = 12 * ((e && e.oct) || 0);
    let any = false;
    for (let r = 0; r < rowsInfo.length; r++) {
        for (let l = 0; l < LAYERS; l++) {
            const ins = state.mel[l][r][s];
            if (!ins || !insAudible(ins)) continue;     // instrument coupé (M) ou hors solo (S)
            if (state.mel.some((grid, q) => q < l && grid[r][s] === ins)) continue;     // même instrument déjà joué sur ce degré et ce pas
            let len = 1;
            if (hold) {
                // des cases voisines d'un même instrument ne font qu'une note tenue (quelle que soit la couche qui les porte) ;
                // un autre instrument en commence une nouvelle
                const prev = s - sgn;
                if (prev >= 0 && prev < L && stackHas(r, prev, ins)) continue;     // suite d'une note tenue : déjà jouée
                while (s + sgn * len >= 0 && s + sgn * len < L && stackHas(r, s + sgn * len, ins)) len++;
            }
            const span = len * d, midi = clamp(rowsInfo[r].midi + 12 * (state.insOct[ins] || 0) + shift, 21, 108);
            for (let k = 0; k < rat; k++) {
                const part = span / rat;
                SeqAudio.playNote(midi, when + k * part, Math.max(0.05, part * (rat > 1 ? 0.8 : (len > 1 ? 0.98 : 0.86))),
                    0.9 * vol * (k === 0 ? 1 : 0.85), fx, ins, insGain(ins));
            }
            any = true;
        }
    }
    return any;
}

// Joue tout ce qui tombe sur ce pas ; renvoie la position et les pistes déclenchées (pour l'affichage).
function triggerTick(n, when, d) {
    const idx = [], fired = [];
    DRUMS.forEach((dr, ti) => {
        const pos = lanePos(dr.id, n);
        idx[ti] = pos.idx;
        if (!state.pat[dr.id][pos.idx] || !audible(dr.id)) return;
        const e = stepExt(dr.id, pos.idx);
        if (!passes(e, pos.cycle)) return;
        playDrumHit(dr, e, when, d);
        fired[ti] = true;
    });
    const mp = lanePos(MEL, n), me = stepExt(MEL, mp.idx);
    idx[DRUMS.length] = mp.idx;
    if (passes(me, mp.cycle) && playMelodyStep(mp.idx, effLen(MEL), me, when, d)) fired[DRUMS.length] = true;
    return { idx, fired };
}

function schedule() {
    const t = SeqAudio.now();
    if (nextTime < t - 0.05) nextTime = t + 0.02;             // l'horloge a pris du retard : on se recale
    const horizon = t + 0.14;
    while (nextTime < horizon) {
        const d = stepDur();
        const lag = (state.div !== 12 && tick % 2 === 1) ? (state.swing / 100) * 0.5 * d : 0;
        const when = nextTime + lag;
        const r = triggerTick(tick, when, d);
        queue.push({ tick, time: when, idx: r.idx, fired: r.fired });
        if (queue.length > 96) queue.shift();
        nextTime += d;
        tick++;
    }
}
const clock = makeClock(schedule, 25);

function draw() {
    if (!playing) return;
    const t = SeqAudio.now();
    let hit = null;
    while (queue.length && queue[0].time <= t) hit = queue.shift();
    if (hit) { setNow(hit); flash(hit.fired); }
    raf = requestAnimationFrame(draw);
}

function start() {
    if (!SeqAudio.init()) return;
    playing = true;
    tick = 0;
    nextTime = SeqAudio.now() + 0.08;
    queue.length = 0;
    schedule();
    clock.start();
    raf = requestAnimationFrame(draw);
    updatePlayUI();
}
function stop() {
    playing = false;
    clock.stop();
    cancelAnimationFrame(raf);
    queue.length = 0;
    SeqAudio.stopAll();
    clearNow();
    updatePlayUI();
}
const toggle = () => { if (playing) stop(); else start(); };

/* ---------- Grilles ---------- */
const mainEl = $('main'), drumRowsEl = $('drumRows'), melRowsEl = $('melRows');
let dBtns = [], dCols = [], dRows = [], leds = [], rcsD = [], chips = [];
let sel = null, editing = false;       // pas ou piste ouverts dans le panneau de réglage ; mode « régler les pas »
let mBtns = [], mCols = [], rcsM = [];       // mBtns[couche][degré][pas] ; mCols[pas] = toutes les cases de la colonne
let shownExtra = new Set();                  // lignes de couches supplémentaires affichées (« couche:degré »)

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

// Compte des pas, sous la grille : « 1 e + a 2 e + a… » (croches : « 1 + 2 + », triolets : « 1 · · 2 · · »)
function stepLabel(i) {
    const g = state.div / 4, k = i % g;
    if (k === 0) return String(i / g + 1);
    if (g === 2) return '+';
    if (g === 4) return ['', 'e', '+', 'a'][k];
    return '·';
}
function buildRuler(host) {
    host.textContent = '';
    const g = state.div / 4, cells = [];
    for (let b = 0; b < 4; b++) {
        const grp = el('div', 'grp');
        for (let k = 0; k < g; k++) {
            const i = b * g + k;
            const c = el('span', 'rc' + (k === 0 ? ' beat' : ''), stepLabel(i));
            cells[i] = c;
            grp.append(c);
        }
        host.append(grp);
    }
    return cells;
}

function makeStep(group, row, i, N, label, on) {
    const g = N / 4;
    const sb = el('button', 'step' + (group === 'm' ? ' mstep' : ''));
    sb.type = 'button';
    sb.dataset.g = group;
    sb.dataset.r = row;
    sb.dataset.i = i;
    if (Math.floor(i / g) % 2 === 1) sb.dataset.alt = '1';
    sb.setAttribute('aria-pressed', on ? 'true' : 'false');
    sb.setAttribute('aria-label', label + ', pas ' + (i + 1) + ' sur ' + N);
    return sb;
}

function buildDrums() {
    const N = state.div, g = N / 4;
    mainEl.style.setProperty('--g', g);
    drumRowsEl.textContent = '';
    dBtns = []; dRows = []; leds = []; chips = [];
    dCols = Array.from({ length: N }, () => []);
    rcsD = buildRuler($('drumRuler'));

    const frag = document.createDocumentFragment();
    DRUMS.forEach((dr, ti) => {
        const row = el('div', 'row track' + (ti > 0 && DRUMS[ti - 1].fam !== dr.fam ? ' fam-start' : ''));
        row.dataset.t = ti;
        row.dataset.fam = dr.fam;

        const th = el('div', 'th');
        const nameBtn = el('button', 'name');
        nameBtn.type = 'button';
        nameBtn.setAttribute('aria-label', 'Écouter : ' + dr.name);
        const led = el('i', 'led');
        nameBtn.append(led, el('span', null, dr.name));

        const m = el('button', 'ms m', 'M');
        m.type = 'button';
        m.title = 'Couper la piste';
        m.setAttribute('aria-label', 'Couper : ' + dr.name);
        m.setAttribute('aria-pressed', state.mute[dr.id] ? 'true' : 'false');
        const s = el('button', 'ms s', 'S');
        s.type = 'button';
        s.title = 'Écouter seule';
        s.setAttribute('aria-label', 'Solo : ' + dr.name);
        s.setAttribute('aria-pressed', state.solo[dr.id] ? 'true' : 'false');

        const vol = el('input', 'vol');
        vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = state.vol[dr.id];
        vol.setAttribute('aria-label', 'Volume : ' + dr.name);
        const chip = el('button', 'lane');
        chip.type = 'button';
        chips[ti] = chip;
        th.append(nameBtn, chip, m, s, vol);

        const steps = el('div', 'steps');
        dBtns[ti] = [];
        for (let b = 0; b < 4; b++) {
            const grp = el('div', 'grp');
            for (let k = 0; k < g; k++) {
                const i = b * g + k;
                const sb = makeStep('d', ti, i, N, dr.name, state.pat[dr.id][i]);
                dBtns[ti][i] = sb;
                dCols[i].push(sb);
                grp.append(sb);
            }
            steps.append(grp);
        }
        row.append(th, steps);
        dRows.push(row);
        leds.push(led);
        frag.append(row);
    });
    drumRowsEl.append(frag);
    refreshAudible();
    decorate();
}

// Une ligne de la grille mélodique : le degré r, couche l (la couche 0 est la ligne principale ; les autres se
// montrent sous elle, quand elles contiennent des notes).
function makeMelRow(l, r) {
    const N = state.div, g = N / 4, info = rowsInfo[r];
    const row = el('div', 'mrow' + (info.isRoot ? ' root' : '') + (l ? ' layer' : ''));
    row.dataset.r = r;
    row.dataset.l = l;

    const lab = el('button', 'mlabel');
    lab.type = 'button';
    lab.dataset.r = r;
    lab.setAttribute('aria-label', 'Écouter : ' + info.name + (info.isRoot ? info.octave : '') + (l ? ' (couche ' + (l + 1) + ')' : ''));
    const nn = el('span', 'nname', info.name);
    if (info.isRoot) nn.append(el('sup', 'oct', String(info.octave)));
    lab.append(el('span', 'deg', info.degree), nn);

    const steps = el('div', 'steps');
    mBtns[l][r] = [];
    for (let b = 0; b < 4; b++) {
        const grp = el('div', 'grp');
        for (let k = 0; k < g; k++) {
            const i = b * g + k;
            const sb = makeStep('m', r, i, N, info.name + info.octave, 0);
            sb.dataset.l = l;
            mBtns[l][r][i] = sb;
            paintMelCell(l, r, i, sb);
            mCols[i].push(sb);
            grp.append(sb);
        }
        steps.append(grp);
    }
    row.append(lab, steps);
    return row;
}

// Lignes de couches à montrer : celles qui contiennent des notes (et, pendant un geste, celles déjà affichées, pour que
// la grille ne bouge pas sous le doigt).
function wantExtra(keepShown) {
    const want = new Set();
    for (let l = 1; l < LAYERS; l++) {
        for (let r = 0; r < rowsInfo.length; r++) {
            if (state.mel[l][r].slice(0, state.div).some(Boolean)) want.add(l + ':' + r);
        }
    }
    if (keepShown) shownExtra.forEach(k => want.add(k));
    return want;
}
function buildMelody() {
    const N = state.div;
    shownExtra = wantExtra(false);
    melRowsEl.textContent = '';
    mBtns = Array.from({ length: LAYERS }, () => []);
    mCols = Array.from({ length: N }, () => []);
    rcsM = buildRuler($('melRuler'));

    const frag = document.createDocumentFragment();
    for (let r = rowsInfo.length - 1; r >= 0; r--) {
        for (let l = 0; l < LAYERS; l++) {
            if (l && !shownExtra.has(l + ':' + r)) continue;
            frag.append(makeMelRow(l, r));
        }
    }
    melRowsEl.append(frag);
    decorate();
}
// Ajoute ou retire les lignes de couches sans reconstruire la grille (les cases en cours de geste restent en place).
// `final` : fin de geste, on retire aussi les lignes devenues vides.
function syncRows(final) {
    const want = wantExtra(!final);
    let changed = false;
    shownExtra.forEach(k => {
        if (want.has(k)) return;
        const [l, r] = k.split(':').map(Number);
        const row = melRowsEl.querySelector('.mrow[data-r="' + r + '"][data-l="' + l + '"]');
        if (row) {
            mCols.forEach((col, i) => { mCols[i] = col.filter(b => !row.contains(b)); });
            row.remove();
        }
        mBtns[l][r] = undefined;
        shownExtra.delete(k);
        changed = true;
    });
    want.forEach(k => {
        if (shownExtra.has(k)) return;
        const [l, r] = k.split(':').map(Number);
        const row = makeMelRow(l, r);
        let ref = null;
        for (let q = l - 1; q >= 0 && !ref; q--) ref = melRowsEl.querySelector('.mrow[data-r="' + r + '"][data-l="' + q + '"]');
        if (ref) ref.after(row); else melRowsEl.append(row);
        shownExtra.add(k);
        changed = true;
    });
    if (changed) decorate();
    renderMixer();
}

function buildAll() {
    shownIdx = [];
    shownTick = -1;
    buildDrums();
    buildMelody();
}

function refreshDrumSteps() {
    const N = state.div;
    DRUMS.forEach((dr, ti) => {
        for (let i = 0; i < N; i++) dBtns[ti][i].setAttribute('aria-pressed', state.pat[dr.id][i] ? 'true' : 'false');
    });
}
function refreshMelSteps() {
    const N = state.div;
    for (let l = 0; l < LAYERS; l++) {
        for (let r = 0; r < rowsInfo.length; r++) {
            if (mBtns[l][r]) for (let i = 0; i < N; i++) paintMelCell(l, r, i);
        }
    }
}
// Remplace toute la mélodie par la grille m (couche 0) : les couches supplémentaires sont vidées.
function setMelody(m) {
    state.mel = [m, emptyMel(), emptyMel()];
    syncRows(true);
    refreshMelSteps();
    save();
}
// Case de la mélodie : allumée dans la couleur de son instrument, ou éteinte.
function paintMelCell(l, r, i, btn) {
    const b = btn || (mBtns[l] && mBtns[l][r] && mBtns[l][r][i]);
    if (!b) return;
    const ins = state.mel[l][r][i], def = ins && SeqAudio.TIMBRES[ins];
    b.setAttribute('aria-pressed', def ? 'true' : 'false');
    if (def) { b.style.setProperty('--on', def.color); b.dataset.ins = ins; } else { b.style.removeProperty('--on'); delete b.dataset.ins; }
    const info = rowsInfo[r];
    b.setAttribute('aria-label', (info ? info.name + info.octave : 'Note') + (def ? ' (' + def.label + ')' : '') + (l ? ', couche ' + (l + 1) : '') + ', pas ' + (i + 1) + ' sur ' + state.div);
    b.title = def ? def.label : '';
}
function refreshAudible() {
    dRows.forEach((row, i) => row.classList.toggle('silent', !audible(DRUMS[i].id)));
}

/* ---------- Tête de lecture ---------- */
// Chaque piste a sa propre case « en cours » (longueurs et sens différents) ; la règle (1 e + a…) suit la mesure.
let shownIdx = [], shownTick = -1;
function nowCells(k, i) {
    if (i == null || i < 0) return [];
    if (k < DRUMS.length) return dBtns[k] && dBtns[k][i] ? [dBtns[k][i]] : [];
    return mCols[i] || [];
}
function clearNow() {
    shownIdx.forEach((i, k) => nowCells(k, i).forEach(b => b.classList.remove('now')));
    [rcsD[shownTick], rcsM[shownTick]].forEach(c => { if (c) c.classList.remove('now'); });
    shownIdx = [];
    shownTick = -1;
}
function setNow(hit) {
    const t = hit.tick % state.div;
    if (t !== shownTick) {
        [rcsD[shownTick], rcsM[shownTick]].forEach(c => { if (c) c.classList.remove('now'); });
        [rcsD[t], rcsM[t]].forEach(c => { if (c) c.classList.add('now'); });
        shownTick = t;
    }
    hit.idx.forEach((i, k) => {
        if (shownIdx[k] === i) return;
        nowCells(k, shownIdx[k]).forEach(b => b.classList.remove('now'));
        nowCells(k, i).forEach(b => b.classList.add('now'));
        shownIdx[k] = i;
    });
}
function blink(ti) {
    const l = leds[ti];
    if (!l) return;
    l.classList.remove('on');
    void l.offsetWidth;
    l.classList.add('on');
}
function flash(fired) {
    fired.forEach((on, ti) => { if (on && ti < DRUMS.length) blink(ti); });
}
function auditionDrum(ti) {
    if (!SeqAudio.init()) return;
    SeqAudio.playDrum(DRUMS[ti].id, DRUMS[ti].drum, SeqAudio.now() + 0.01);
    blink(ti);
}
function auditionNote(r, ins) {
    if (!SeqAudio.init() || !rowsInfo[r]) return;
    const k = ins || state.timbre;
    SeqAudio.playNote(clamp(rowsInfo[r].midi + 12 * (state.insOct[k] || 0), 21, 108), SeqAudio.now() + 0.01, 0.6, 0.9, null, k, insGain(k));
}

/* ---------- Affichage des réglages ---------- */
const fmtVal = v => String(v);
function paintRange(input) {
    const min = +input.min, max = +input.max;
    input.style.setProperty('--sl-p', String((+input.value - min) / (max - min)));
}

function renderTempo() {
    $('bpm').value = state.bpm;
    $('bpmBig').value = state.bpm;
    $('tempo').value = state.bpm;
    paintRange($('tempo'));
}
function renderSwing() {
    const tri = state.div === 12;
    $('swing').value = state.swing;
    paintRange($('swing'));
    $('swing').disabled = tri;
    $('swingBadge').textContent = tri ? '—' : state.swing + ' %';
    $('swingBlock').classList.toggle('off', tri);
    $('swingHint').hidden = !tri;
}
function renderDiv() {
    $('seg').querySelectorAll('button').forEach(b => {
        const on = +b.dataset.div === state.div;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('divBadge').textContent = state.div + ' pas';
    renderSwing();
}
function renderPreset() {
    $('preset').value = state.preset;
    const label = PRESETS[state.style].label;
    $('styleBadge').textContent = label;
    $('drumGen').title = 'Autre proposition de batterie dans le style : ' + label;
    $('melGen').title = 'Autre phrase dans le style : ' + label + ' (tient compte de la batterie posée)';
}
function renderVolumes() {
    $('volDrums').value = state.drumVol;
    $('volMel').value = state.melVol;
    $('volDrumsOut').textContent = fmtVal(state.drumVol);
    $('volMelOut').textContent = fmtVal(state.melVol);
    paintRange($('volDrums'));
    paintRange($('volMel'));
}
function renderMelodyControls() {
    $('selRoot').value = state.root;
    $('selScale').value = state.scale;
    renderInstruments();
    $('selOct').value = String(state.octave);
    $('selRange').value = String(state.range);
    $('rootBadge').textContent = Theory.rootLabel(state.root);
    $('scaleBadge').textContent = Theory.scaleById(state.scale).name;
}
function updatePlayUI() {
    $('playLabel').textContent = playing ? 'Arrêter' : 'Jouer';
    $('icoPlay').hidden = playing;
    $('icoStop').hidden = !playing;
    $('play').classList.toggle('is-playing', playing);
}
function renderAll() {
    renderTempo();
    renderDiv();
    renderPreset();
    renderVolumes();
    renderMelodyControls();
}

/* ---------- Actions ---------- */
function setBpm(v) {
    state.bpm = clamp(Math.round(+v || state.bpm), 40, 220);
    renderTempo();
    save();
}

// Que fait un clic sur la case (g, r, i), couche l ? Batterie : allumée / éteinte. Mélodie, selon le geste :
//   « paint »    : pose l'instrument choisi (sur une couche libre, sous la note déjà là, s'il y en a une d'un autre instrument)
//   « erase »    : retire l'instrument choisi de ce degré et de ce pas (c'est le cas si on clique là où il est déjà)
//   « replace »  : (Alt + clic) remplace la case cliquée par l'instrument choisi
//   « eraseAny » : (Maj + clic) efface la case cliquée, quel que soit son instrument
function nextVal(g, r, i, l, e) {
    if (g === 'd') return !state.pat[DRUMS[r].id][i];
    if (e && e.shiftKey) return 'eraseAny';
    if (e && e.altKey) return 'replace';
    return stackHas(r, i, state.timbre) ? 'erase' : 'paint';
}

// Applique un geste de mélodie ; renvoie vrai si quelque chose a changé.
function applyMel(mode, l, r, i) {
    const ins = state.timbre, M = state.mel;
    if (mode === 'eraseAny') {
        if (!M[l][r][i]) return false;
        M[l][r][i] = 0;
    } else if (mode === 'erase') {
        const k = M.findIndex(grid => grid[r][i] === ins);
        if (k < 0) return false;
        M[k][r][i] = 0;
    } else if (mode === 'replace') {
        if (M[l][r][i] === ins) return false;
        M.forEach(grid => { if (grid[r][i] === ins) grid[r][i] = 0; });
        M[l][r][i] = ins;
    } else {
        if (stackHas(r, i, ins)) return false;
        let t = l;
        if (M[l][r][i]) { const f = M.findIndex(grid => !grid[r][i]); if (f >= 0) t = f; }      // case prise : couche libre (sinon, on remplace)
        M[t][r][i] = ins;
    }
    return true;
}

function apply(g, r, i, v, l) {
    if (g === 'd') {
        const val = v ? 1 : 0, id = DRUMS[r].id;
        if (state.pat[id][i] === val) return;
        state.pat[id][i] = val;
        dBtns[r][i].setAttribute('aria-pressed', val ? 'true' : 'false');
        if (state.preset) { state.preset = ''; renderPreset(); }
        if (val && !playing) auditionDrum(r);
    } else {
        if (!applyMel(v, l || 0, r, i)) return;
        for (let q = 0; q < LAYERS; q++) paintMelCell(q, r, i);
        syncRows(false);
        if ((v === 'paint' || v === 'replace') && !playing) auditionNote(r, state.timbre);
    }
    save();
}

function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.pat = mkPat(p.map);
    state.bpm = p.bpm;
    state.swing = p.swing;
    state.preset = key;
    state.style = key;
    DRUMS.forEach(dr => { state.ext[dr.id] = {}; state.len[dr.id] = 0; state.dir[dr.id] = 'fwd'; });
    const changed = state.div !== p.div;
    state.div = p.div;
    if (changed) {
        queue.length = 0;
        buildAll();
    } else {
        refreshDrumSteps();
    }
    decorate();
    renderInsp();
    renderAll();
    save();
}

function drumProb(id, i, g) {
    const beat = i % g === 0, strong = i % (2 * g) === 0, back = i % (2 * g) === g;
    const mid = g % 2 === 0 && i % g === g / 2;
    switch (id) {
        case 'kick':  return strong ? 0.92 : beat ? 0.35 : 0.1;
        case 'snare': return back ? 0.92 : beat ? 0.05 : 0.07;
        case 'rim':   return back ? 0.12 : 0.07;
        case 'hat':   return beat ? 0.85 : mid ? 0.7 : 0.3;
        case 'ohat':  return mid ? 0.16 : 0.03;
        case 'ride':  return 0.04;
        case 'bell':  return 0.1;
        case 'tom':   return 0.06;
        default:      return 0.09;
    }
}
function randomDrums() {
    const N = state.div, g = N / 4;
    DRUMS.forEach(dr => {
        const a = Array(MAXSTEPS).fill(0);
        for (let i = 0; i < N; i++) a[i] = Math.random() < drumProb(dr.id, i, g) ? 1 : 0;
        state.pat[dr.id] = a;
    });
    state.preset = '';
    refreshDrumSteps();
    renderPreset();
    save();
}
function clearDrums() {
    DRUMS.forEach(dr => { state.pat[dr.id] = Array(MAXSTEPS).fill(0); state.ext[dr.id] = {}; });
    state.preset = '';
    refreshDrumSteps();
    decorate();
    renderInsp();
    renderPreset();
    save();
}

// « Générer » : phrase dans l'esprit du dernier style de batterie choisi (voir `feel` dans PRESETS). Une note est tirée à chaque pas selon sa place dans la mesure (temps, contretemps, autres) et selon la batterie :
// les pas où jouent la grosse caisse, la caisse claire ou un instrument rythmique (rim, claves, cloche, tom) sont favorisés.
// La hauteur marche de proche en proche sur les lignes de la gamme (notes d'accord favorisées, saut limité), une note peut être
// tenue, et le motif peut être répété sur la mesure. L'instrument est celui de la palette.
function generateMelody() {
    const N = state.div, g = N / 4, R = rowsInfo.length, n = Theory.scaleById(state.scale).tokens.length;
    const feel = Object.assign({}, DEFAULT_FEEL, (PRESETS[state.style] || {}).feel);
    const M = feel.rep ? Math.min(N, feel.rep * g) : N;
    const m = emptyMel();
    const hit = i => {
        const P = state.pat, on = id => P[id] && P[id][i];
        return Math.max(on('kick') ? 1 : 0, on('snare') ? 0.7 : 0, (on('rim') || on('clave') || on('bell')) ? 0.55 : 0, on('tom') ? 0.4 : 0);
    };
    // notes d'accord : fondamentale, tierce (mineure ou majeure) et quinte, quelle que soit la gamme
    const chordRow = r => [0, 3, 4, 7].indexOf((rowsInfo[r].midi - rowsInfo[0].midi) % 12) !== -1;
    let prev = clamp(Math.round((R - 1) / (2 * n)) * n, 0, R - 1), dir = 0;
    for (let i = 0; i < M; i++) {
        const k = i % g;
        const base = i === 0 ? feel.first : k === 0 ? feel.beat : (g === 2 || k === 2) ? feel.off : feel.weak;
        if (Math.random() >= clamp(base * feel.dens + feel.lock * hit(i), 0, 0.95)) continue;
        const cand = [];
        for (let d = -feel.leap; d <= feel.leap; d++) {
            const r = prev + d;
            if (r < 0 || r >= R) continue;
            let w = chordRow(r) ? feel.chord * (k === 0 ? 1.5 : 1) : 1;
            if (d === 0) w *= feel.again;
            else {
                w /= 1 + 0.6 * (Math.abs(d) - 1);
                if (dir && Math.sign(d) === dir) w *= feel.run;
            }
            cand.push({ r, w });
        }
        let x = Math.random() * cand.reduce((t, c) => t + c.w, 0), pick = cand[0].r;
        for (const c of cand) { x -= c.w; if (x <= 0) { pick = c.r; break; } }
        dir = pick > prev ? 1 : pick < prev ? -1 : dir;
        prev = pick;
        m[pick][i] = state.timbre;
        if (i + 1 < M && Math.random() < feel.tie) { m[pick][i + 1] = state.timbre; i++; }     // note tenue
    }
    if (M < N) m.forEach(row => { for (let i = M; i < N; i++) row[i] = row[i % M]; });          // motif répété
    setMelody(m);
}
// « Au hasard » : phrase libre, indépendante du style : marche sur les lignes de la gamme (de proche en proche), plutôt sur les
// temps, avec des silences. Toutes les cases prennent l'instrument de la palette.
function randomMelody() {
    const N = state.div, g = N / 4, R = rowsInfo.length, n = Theory.scaleById(state.scale).tokens.length;
    const m = emptyMel();
    let prev = Math.floor(R / 2);
    for (let i = 0; i < N; i++) {
        if (Math.random() > (i % g === 0 ? 0.78 : 0.36)) continue;
        const cand = [];
        for (let d = -2; d <= 2; d++) {
            const r = prev + d;
            if (r < 0 || r >= R) continue;
            const w = ([0, 2, 4].indexOf(r % n) !== -1 ? 2 : 1) - (d === 0 ? 0.5 : 0);
            cand.push({ r, w });
        }
        let x = Math.random() * cand.reduce((s, c) => s + c.w, 0), pick = cand[0].r;
        for (const c of cand) { x -= c.w; if (x <= 0) { pick = c.r; break; } }
        m[pick][i] = state.timbre;
        prev = pick;
    }
    setMelody(m);
}

// « Générer » (batterie) : une autre proposition dans le dernier style choisi. On part du rythme du style, dont on garde
// l'ossature (grosse caisse sur le 1, caisse claire sur les contretemps, claves intactes), puis on varie : coups retirés
// ou ajoutés près de ceux du style (reprises de grosse caisse, doubles-croches de charleston, notes fantômes), et parfois
// un petit roulement sur le dernier temps. Les pistes absentes du style restent vides. Le style règle aussi la subdivision.
const GEN = {         // keep : chance de garder un coup du style · near / far : chance d'en ajouter à côté d'un coup du style / ailleurs
    kick:  { keep: 0.85, near: 0.12, far: 0.03 },
    snare: { keep: 1,    near: 0.03, far: 0.02 },
    rim:   { keep: 0.9,  near: 0.06, far: 0.03 },
    hat:   { keep: 0.92, near: 0.1,  far: 0.06 },
    ohat:  { keep: 0.8,  near: 0.04, far: 0.04 },
    ride:  { keep: 0.95, near: 0.05, far: 0.02 },
    bell:  { keep: 0.95, near: 0.03, far: 0.02 },
    tom:   { keep: 0.85, near: 0.06, far: 0.03 },
    clave: { keep: 1,    near: 0,    far: 0 }
};
function generateDrums() {
    const style = PRESETS[state.style] || PRESETS.rock;
    if (state.div !== style.div) {
        state.div = style.div;
        queue.length = 0;
        buildAll();
        renderDiv();
    }
    const N = state.div, g = N / 4;
    DRUMS.forEach(dr => {
        const a = Array(MAXSTEPS).fill(0), steps = (style.map[dr.id] || []).filter(i => i < N), cfg = GEN[dr.id];
        if (steps.length) {
            const base = Array(N).fill(0), snareBase = i => (style.map.snare || []).indexOf(i) !== -1;
            steps.forEach(i => { base[i] = 1; });
            for (let i = 0; i < N; i++) {
                if (base[i]) {
                    const backbone = (dr.id === 'kick' && i === 0) || (dr.id === 'snare' && i % (2 * g) === g);
                    a[i] = (backbone || Math.random() < cfg.keep) ? 1 : 0;
                } else {
                    const near = base[(i + N - 1) % N] || base[(i + 1) % N];
                    if (dr.id === 'kick' && snareBase(i)) continue;          // pas de grosse caisse sur la caisse claire
                    if (Math.random() < (near ? cfg.near : cfg.far)) a[i] = 1;
                }
            }
        }
        state.pat[dr.id] = a;
    });
    const fillLane = style.map.tom ? 'tom' : style.map.snare ? 'snare' : null;      // roulement sur le dernier temps
    if (fillLane && Math.random() < 0.4) {
        for (let i = N - g + 1; i < N; i++) if (Math.random() < 0.45) state.pat[fillLane][i] = 1;
    }
    state.preset = state.style;
    refreshDrumSteps();
    renderPreset();
    renderInsp();
    save();
}

function clearMelody() {
    state.mel = emptyMelLayers();
    syncRows(true);
    state.ext[MEL] = {};
    decorate();
    renderInsp();
    refreshMelSteps();
    save();
}

function rebuildMelody() {
    refreshRows();
    buildMelody();
    clearNow();
    renderMelodyControls();
    renderInsp();
    save();
}

/* ---------- Réglages de pas et de piste ---------- */
const laneIdx = id => LANES.indexOf(id);                          // 0..8 : batterie, 9 : mélodie
const laneName = id => id === MEL ? 'Mélodie' : DRUMS[laneIdx(id)].name;
const laneOfBtn = b => b.dataset.g === 'd' ? DRUMS[+b.dataset.r].id : MEL;
const hasMod = e => !!(e && (e.cond || e.rat || e.vol != null || e.flt != null || e.pan || e.rev || e.oct));

function stepCells(id, i) {
    if (id === MEL) return mCols[i] || [];
    const k = laneIdx(id);
    return dBtns[k] && dBtns[k][i] ? [dBtns[k][i]] : [];
}
// Probabilité = transparence du pas allumé ; coin marqué = condition, répétitions ou verrous.
function paintStep(id, i) {
    const e = stepExt(id, i);
    stepCells(id, i).forEach(b => {
        if (e && e.prob != null) b.style.setProperty('--pa', (0.32 + 0.68 * e.prob / 100).toFixed(2));
        else b.style.removeProperty('--pa');
        if (hasMod(e)) b.dataset.mod = '1'; else delete b.dataset.mod;
    });
}
function paintLen() {
    const N = state.div;
    LANES.forEach(id => {
        const L = effLen(id), custom = L !== N || state.dir[id] !== 'fwd';
        const chip = id === MEL ? $('melLane') : chips[laneIdx(id)];
        if (chip) {
            chip.textContent = (id === MEL ? 'Boucle ' + L + ' ' : L) + dirSym(state.dir[id]);
            chip.classList.toggle('custom', custom);
            chip.title = 'Boucle de ' + L + ' pas, sens : ' + DIRS.find(d => d[0] === state.dir[id])[2].toLowerCase() + ' — régler la longueur et le sens';
            chip.setAttribute('aria-label', laneName(id) + ' : boucle de ' + L + ' pas. Régler la boucle.');
        }
        for (let i = 0; i < N; i++) stepCells(id, i).forEach(b => b.classList.toggle('beyond', i >= L));
    });
}
function paintSel() {
    mainEl.querySelectorAll('.step.sel').forEach(b => b.classList.remove('sel'));
    chips.forEach(c => c.classList.remove('open'));
    $('melLane').classList.remove('open');
    if (!sel) return;
    if (sel.step != null && sel.step < state.div) stepCells(sel.lane, sel.step).forEach(b => b.classList.add('sel'));
    const c = sel.lane === MEL ? $('melLane') : chips[laneIdx(sel.lane)];
    if (c && sel.step == null) c.classList.add('open');
}
// Remet à jour tout l'aspect lié aux réglages (après une reconstruction de grille, un rythme prêt, etc.)
function decorate() {
    LANES.forEach(id => { for (let i = 0; i < state.div; i++) paintStep(id, i); });
    paintLen();
    paintSel();
}

const insp = $('insp');
const SLIDERS = { prob: ['iProb', 100], vol: ['iVol', 100], flt: ['iFlt', 100], pan: ['iPan', 0], rev: ['iRev', 0] };
function fmtExt(k, v) {
    if (k === 'flt') return v >= 100 ? 'ouvert' : v + ' %';
    if (k === 'pan') return v === 0 ? 'centre' : (v < 0 ? 'G ' : 'D ') + Math.abs(v);
    return v + ' %';
}
function setSeg(host, val) {
    host.querySelectorAll('button').forEach(b => {
        const on = b.dataset.v === String(val);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}
function renderInsp() {
    if (!sel) return;
    const id = sel.lane, isMel = id === MEL;
    if (sel.step != null && sel.step >= state.div) { sel.step = null; paintSel(); }
    const st = sel.step;
    $('inspTitle').textContent = laneName(id) + (st != null ? ' · pas ' + (st + 1) : ' · boucle');
    $('inspStep').hidden = st == null;
    $('iOctBlock').hidden = !isMel;
    $('iMelHint').hidden = !isMel;
    if (st != null) {
        const e = stepExt(id, st) || {};
        Object.keys(SLIDERS).forEach(k => {
            const inp = $(SLIDERS[k][0]), v = e[k] != null ? e[k] : SLIDERS[k][1];
            inp.value = v;
            paintRange(inp);
            $(SLIDERS[k][0] + 'Out').textContent = fmtExt(k, v);
        });
        $('iCond').value = e.cond || '';
        $('iInv').checked = !!e.inv;
        $('iInv').disabled = !e.cond;
        setSeg($('iRat'), e.rat || 1);
        setSeg($('iOct'), e.oct || 0);
    }
    $('iLen').value = effLen(id);
    $('iLen').max = state.div;
    setSeg($('iDir'), state.dir[id]);
}
function openInspector(id, step) {
    sel = { lane: id, step };
    insp.hidden = false;
    document.body.classList.add('insp-open');
    paintSel();
    renderInsp();
    // Téléphone : le panneau couvre le bas de l'écran ; on remonte le pas choisi pour qu'il reste visible
    if (window.innerWidth < 1024 && step != null) {
        const c = stepCells(id, step)[0];
        if (c) {
            const r = c.getBoundingClientRect();
            if (r.top < 70 || r.top > window.innerHeight * 0.36) window.scrollBy({ top: r.top - 130, behavior: 'smooth' });
        }
    }
}
function closeInspector() {
    sel = null;
    insp.hidden = true;
    document.body.classList.remove('insp-open');
    paintSel();
}
function setEditing(v) {
    editing = v;
    mainEl.classList.toggle('editing', v);
    ['editDrums', 'editMel'].forEach(id => $(id).setAttribute('aria-pressed', v ? 'true' : 'false'));
}

function setExt(k, val) {
    if (!sel || sel.step == null) return;
    const id = sel.lane, i = sel.step, bag = state.ext[id];
    const e = bag[i] || (bag[i] = {});
    const sp = EXT_SPEC[k];
    const isDef = sp ? val === sp[2] : (k === 'cond' || k === 'inv') ? !val : k === 'rat' ? val === 1 : val === 0;
    if (isDef) delete e[k]; else e[k] = val;
    if (k === 'cond' && !val) delete e.inv;
    if (!Object.keys(e).length) delete bag[i];
    paintStep(id, i);
    renderInsp();
    save();
}
function setLen(v) {
    if (!sel) return;
    const n = clamp(Math.round(+v) || 1, 1, state.div);
    state.len[sel.lane] = n === state.div ? 0 : n;
    paintLen();
    renderInsp();
    save();
}
function setDir(v) {
    if (!sel || !DIRS.some(d => d[0] === v)) return;
    state.dir[sel.lane] = v;
    paintLen();
    renderInsp();
    save();
}

insp.addEventListener('input', e => {
    const t = e.target, k = t.dataset.k;
    if (!k || !sel) return;
    if (t.type === 'range') setExt(k, +t.value);
    else if (k === 'cond') setExt('cond', t.value);
    else if (k === 'inv') setExt('inv', t.checked);
});
$('iLen').addEventListener('change', () => setLen($('iLen').value));
insp.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !sel) return;
    if (b.id === 'inspClose') { closeInspector(); return; }
    if (b.id === 'iLenDown') { setLen(effLen(sel.lane) - 1); return; }
    if (b.id === 'iLenUp') { setLen(effLen(sel.lane) + 1); return; }
    if (b.id === 'iResetStep') {
        if (sel.step != null) { delete state.ext[sel.lane][sel.step]; paintStep(sel.lane, sel.step); renderInsp(); save(); }
        return;
    }
    if (b.id === 'iResetLane') { state.len[sel.lane] = 0; state.dir[sel.lane] = 'fwd'; paintLen(); renderInsp(); save(); return; }
    const k = b.dataset.k, v = b.dataset.v;
    if (k === 'rat' || k === 'oct') setExt(k, +v);
    else if (k === 'dir') setDir(v);
});

/* ---------- Construction des menus et des boutons ---------- */
(function buildControls() {
    const seg = $('seg');
    DIVS.forEach(d => {
        const b = el('button', null, d[1]);
        b.type = 'button';
        b.dataset.div = d[0];
        b.title = d[3] + ' : ' + d[2];
        seg.append(b);
    });

    const pre = $('preset');
    const custom = el('option', null, 'Personnalisé');
    custom.value = '';
    pre.append(custom);
    Object.keys(PRESETS).forEach(k => {
        const o = el('option', null, PRESETS[k].label);
        o.value = k;
        pre.append(o);
    });

    Theory.ROOTS.forEach(k => {
        const o = el('option', null, Theory.rootLabel(k));
        o.value = k;
        $('selRoot').append(o);
    });
    let group = null, og = null;
    Theory.SCALES.forEach(sc => {
        if (sc.group !== group) { group = sc.group; og = document.createElement('optgroup'); og.label = group; $('selScale').append(og); }
        const o = el('option', null, sc.name);
        o.value = sc.id;
        og.append(o);
    });
    [2, 3, 4, 5].forEach(n => {
        const o = el('option', null, 'Octave ' + n);
        o.value = String(n);
        $('selOct').append(o);
    });
    [[1, '1 octave'], [2, '2 octaves']].forEach(r => {
        const o = el('option', null, r[1]);
        o.value = String(r[0]);
        $('selRange').append(o);
    });
})();

/* ---------- Événements ---------- */
$('play').addEventListener('click', toggle);

$('bpm').addEventListener('change', () => setBpm($('bpm').value));
$('bpmBig').addEventListener('change', () => setBpm($('bpmBig').value));
[$('bpm'), $('bpmBig')].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); }));
$('tempo').addEventListener('input', () => setBpm($('tempo').value));

function holdRepeat(btn, delta) {
    let to = 0, iv = 0;
    const halt = () => { clearTimeout(to); clearInterval(iv); };
    btn.addEventListener('pointerdown', () => {
        setBpm(state.bpm + delta);
        to = setTimeout(() => { iv = setInterval(() => setBpm(state.bpm + delta), 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, halt));
    btn.addEventListener('click', e => { if (e.detail === 0) setBpm(state.bpm + delta); });
}
holdRepeat($('bpmDown'), -1);
holdRepeat($('bpmUp'), 1);

let taps = [];
function tap() {
    const n = performance.now();
    if (taps.length && n - taps[taps.length - 1] > 2000) taps = [];
    taps.push(n);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
}
$('tap').addEventListener('pointerdown', tap);
$('tap').addEventListener('click', e => { if (e.detail === 0) tap(); });

$('swing').addEventListener('input', () => {
    state.swing = clamp(Math.round(+$('swing').value || 0), 0, 100);
    renderSwing();
    save();
});

$('seg').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = +b.dataset.div;
    if (d === state.div) return;
    state.div = d;
    queue.length = 0;
    buildAll();
    renderDiv();
    renderInsp();
    save();
});

$('volDrums').addEventListener('input', () => {
    state.drumVol = +$('volDrums').value;
    SeqAudio.setDrumVolume(state.drumVol / 100);
    renderVolumes();
    save();
});
$('volMel').addEventListener('input', () => {
    state.melVol = +$('volMel').value;
    SeqAudio.setMelodyVolume(state.melVol / 100);
    renderVolumes();
    save();
});

$('asideToggle').addEventListener('click', () => {
    const open = $('aside').classList.toggle('open');
    $('asideToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
});

$('preset').addEventListener('change', () => { if ($('preset').value) applyPreset($('preset').value); });
$('drumRand').addEventListener('click', randomDrums);
$('drumGen').addEventListener('click', generateDrums);
$('drumClear').addEventListener('click', clearDrums);
$('melRand').addEventListener('click', randomMelody);
$('melGen').addEventListener('click', generateMelody);
$('melClear').addEventListener('click', clearMelody);
$('editDrums').addEventListener('click', () => setEditing(!editing));
$('editMel').addEventListener('click', () => setEditing(!editing));
$('melLane').addEventListener('click', () => openInspector(MEL, null));

$('selRoot').addEventListener('change', () => { state.root = $('selRoot').value; rebuildMelody(); });
$('selScale').addEventListener('change', () => { state.scale = $('selScale').value; rebuildMelody(); });
$('selOct').addEventListener('change', () => { state.octave = +$('selOct').value; rebuildMelody(); });
$('selRange').addEventListener('change', () => { state.range = +$('selRange').value; rebuildMelody(); });

/* ---------- Instruments de la mélodie ---------- */
// Palette : l'instrument choisi est celui des prochaines cases posées (chacune garde le sien et sa couleur).
const palEl = $('insPalette');
function buildPalette() {
    Object.keys(SeqAudio.TIMBRES).forEach(k => {
        const def = SeqAudio.TIMBRES[k];
        const b = el('button', 'ins');
        b.type = 'button';
        b.dataset.ins = k;
        b.setAttribute('role', 'radio');
        b.style.setProperty('--ic', def.color);
        const dot = el('i', 'dot');
        b.append(dot, el('span', null, def.label));
        palEl.append(b);
    });
}
function renderInstruments() {
    renderMixer();
    const k = state.timbre, def = SeqAudio.TIMBRES[k];
    palEl.querySelectorAll('.ins').forEach(b => {
        const on = b.dataset.ins === k;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
    });
    $('insName').textContent = def.label;
    $('insName').style.setProperty('--ic', def.color);
    const o = state.insOct[k] || 0;
    $('insOctOut').value = (o > 0 ? '+' : o < 0 ? '−' : '') + Math.abs(o);
}
// Mélangeur : un curseur par instrument qui joue dans la mélodie (plus l'instrument de la palette, pour le régler avant de poser).
const insMixEl = $('insMix');
let mixSig = '';
function usedInstruments() {
    const used = new Set([state.timbre]);
    state.mel.forEach(grid => {
        for (let r = 0; r < rowsInfo.length; r++) for (let i = 0; i < state.div; i++) if (grid[r][i]) used.add(grid[r][i]);
    });
    return Object.keys(SeqAudio.TIMBRES).filter(k => used.has(k));
}
function renderMixer() {
    const keys = usedInstruments(), sig = keys.join(',');
    mixKeys = keys;
    if (sig === mixSig) return;
    mixSig = sig;
    insMixEl.textContent = '';
    keys.forEach(k => {
        const def = SeqAudio.TIMBRES[k], row = el('div', 'vrow ins-row');
        row.dataset.ins = k;
        const name = el('span', 'ins-name');
        name.append(el('i', 'dot'), el('span', null, def.label));
        name.firstChild.style.background = def.color;
        const inp = el('input', 'rng');
        inp.type = 'range'; inp.min = 0; inp.max = 150; inp.step = 1; inp.value = state.insVol[k];
        inp.style.setProperty('--sl-accent', def.color);
        inp.setAttribute('aria-label', 'Niveau : ' + def.label);
        paintRange(inp);
        const out = el('output', null, String(state.insVol[k]));
        const m = el('button', 'ms m', 'M');
        m.type = 'button'; m.title = 'Couper l’instrument';
        m.setAttribute('aria-label', 'Couper : ' + def.label);
        const so = el('button', 'ms s', 'S');
        so.type = 'button'; so.title = 'Écouter l’instrument seul';
        so.setAttribute('aria-label', 'Solo : ' + def.label);
        row.append(name, inp, out, m, so);
        insMixEl.append(row);
    });
    refreshInsAudible();
}
insMixEl.addEventListener('click', e => {
    const b = e.target.closest('.ms');
    const row = b && b.closest('.ins-row');
    if (!row) return;
    const f = b.classList.contains('m') ? 'insMute' : 'insSolo', k = row.dataset.ins;
    state[f][k] = !state[f][k];
    refreshInsAudible();
    save();
});
insMixEl.addEventListener('input', e => {
    const row = e.target.closest('.ins-row');
    if (!row || !e.target.matches('input')) return;
    const k = row.dataset.ins;
    state.insVol[k] = clamp(+e.target.value, 0, 150);
    row.querySelector('output').textContent = String(state.insVol[k]);
    paintRange(e.target);
    save();
});
insMixEl.addEventListener('change', e => {                  // au relâchement : on entend l'instrument à son nouveau niveau
    const row = e.target.closest('.ins-row');
    if (row && !playing) auditionNote(0, row.dataset.ins);
});

function setInstrument(k) {
    if (!SeqAudio.TIMBRES[k]) return;
    state.timbre = k;
    SeqAudio.setTimbre(k);
    renderInstruments();
    save();
    if (!playing) auditionNote(0);                 // on entend l'instrument sur la fondamentale
}
function shiftInstrumentOctave(d) {
    const k = state.timbre;
    state.insOct[k] = clamp((state.insOct[k] || 0) + d, -3, 3);
    renderInstruments();
    save();
    if (!playing) auditionNote(0);
}
// Éditeur de son : patch FM de l'instrument, filtre, delay… (voir editor.js)
SoundEditor.init({
    timbres: SeqAudio.TIMBRES,
    getSound: k => state.snd[k],
    commit: k => { SeqAudio.setSound(k, state.snd[k]); save(); },
    replace: (k, s) => { state.snd[k] = s; SeqAudio.setSound(k, s); save(); },
    audition: (midi, k) => {
        if (!SeqAudio.init()) return;
        SeqAudio.want([k]);
        SeqAudio.playNote(midi, SeqAudio.now() + 0.01, 0.7, 0.9, null, k, 1);
    },
    isPlaying: () => playing,
    select: k => { if (k !== state.timbre) setInstrument(k); }
});
$('insEdit').addEventListener('click', () => SoundEditor.open(state.timbre));
insMixEl.addEventListener('click', e => {                   // clic sur le nom d'un instrument du mélange : son éditeur
    const n = e.target.closest('.ins-name'), row = n && n.closest('.ins-row');
    if (row) SoundEditor.open(row.dataset.ins);
});
buildPalette();
palEl.addEventListener('click', e => {
    const b = e.target.closest('.ins');
    if (b) setInstrument(b.dataset.ins);
});
palEl.addEventListener('keydown', e => {                 // flèches : instrument précédent / suivant
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) return;
    const keys = Object.keys(SeqAudio.TIMBRES), i = keys.indexOf(state.timbre);
    const n = keys[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + keys.length) % keys.length];
    e.preventDefault();
    setInstrument(n);
    const nb = palEl.querySelector('.ins[data-ins="' + n + '"]');
    if (nb) nb.focus();
});
$('insOctDown').addEventListener('click', () => shiftInstrumentOctave(-1));
$('insOctUp').addEventListener('click', () => shiftInstrumentOctave(1));

// Clics dans les grilles : noms de pistes, M / S, volumes, étiquettes de notes, pas (clavier)
mainEl.addEventListener('click', e => {
    const step = e.target.closest('.step');
    if (step) {
        if (e.detail === 0) {      // activation au clavier (la souris et le doigt passent par les événements « pointer »)
            const g = step.dataset.g, r = +step.dataset.r, i = +step.dataset.i, l = +step.dataset.l || 0;
            if (editing) { openInspector(laneOfBtn(step), i); return; }
            apply(g, r, i, nextVal(g, r, i, l, e), l);
            if (g === 'm') syncRows(true);
        }
        return;
    }
    const lab = e.target.closest('.mlabel');
    if (lab) { auditionNote(+lab.dataset.r); return; }
    const row = e.target.closest('.track');
    if (!row) return;
    const ti = +row.dataset.t, id = DRUMS[ti].id;
    if (e.target.closest('.lane')) { openInspector(id, null); return; }
    const ms = e.target.closest('.ms');
    if (ms) {
        const k = ms.classList.contains('m') ? 'mute' : 'solo';
        state[k][id] = !state[k][id];
        ms.setAttribute('aria-pressed', state[k][id] ? 'true' : 'false');
        refreshAudible();
        save();
        return;
    }
    if (e.target.closest('.name')) auditionDrum(ti);
});
mainEl.addEventListener('input', e => {
    const v = e.target.closest('.vol');
    if (!v) return;
    const id = DRUMS[+v.closest('.track').dataset.t].id;
    state.vol[id] = clamp(+v.value, 0, 100);
    SeqAudio.setTrackVolume(id, state.vol[id] / 100);
    save();
});
// Clic droit (ou appui long au doigt) sur un pas : ouvre ses réglages
mainEl.addEventListener('contextmenu', e => {
    const b = e.target.closest('.step');
    if (!b) return;
    e.preventDefault();
    openInspector(laneOfBtn(b), +b.dataset.i);
});

// Activer ou peindre des pas : souris, doigt ou stylet. Au doigt, le pas ne change qu'au relâchement (pour pouvoir
// faire défiler la page) ; en glissant le long d'une ligne, on peint tous les pas traversés (cases voisines d'une
// ligne mélodique = une note tenue).
if (typeof Keepalive !== 'undefined') Keepalive.install(() => SeqAudio.init()); // iPhone : son malgré le mode silencieux, écran allumé

let drag = null;
mainEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('.step');
    if (!b) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    SeqAudio.init();
    const g = b.dataset.g, r = +b.dataset.r, i = +b.dataset.i, l = +b.dataset.l || 0, lane = laneOfBtn(b);
    if (editing) {            // mode « régler les pas » : on choisit le pas, on ne le change pas
        if (e.pointerType === 'mouse') { openInspector(lane, i); drag = null; }
        else drag = { edit: true, lane, start: i, x: e.clientX, y: e.clientY };
        return;
    }
    drag = { g, r, l, start: i, value: nextVal(g, r, i, l, e), applied: false, x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse') {
        apply(g, r, i, drag.value, l);
        drag.applied = true;
    } else {
        // appui long au doigt (sans bouger) : réglages du pas
        drag.lp = setTimeout(() => {
            if (!drag || drag.applied) return;
            const d = drag;
            drag = null;
            openInspector(lane, d.start);
            if (navigator.vibrate) navigator.vibrate(12);
        }, 520);
    }
});
window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.lp && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { clearTimeout(drag.lp); drag.lp = 0; }
    if (drag.edit) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const b = hit && hit.closest ? hit.closest('.step') : null;
    if (!b || b.dataset.g !== drag.g || +b.dataset.r !== drag.r || (+b.dataset.l || 0) !== drag.l) return;
    const i = +b.dataset.i;
    if (!drag.applied) {
        if (i === drag.start) return;
        apply(drag.g, drag.r, drag.start, drag.value, drag.l);
        drag.applied = true;
    }
    apply(drag.g, drag.r, i, drag.value, drag.l);
});
window.addEventListener('pointerup', () => {
    if (!drag) return;
    clearTimeout(drag.lp);
    if (drag.edit) openInspector(drag.lane, drag.start);
    else if (!drag.applied) apply(drag.g, drag.r, drag.start, drag.value, drag.l);
    if (drag.g === 'm') syncRows(true);            // fin du geste : on retire les lignes de couches devenues vides
    drag = null;
});
window.addEventListener('pointercancel', () => { if (drag) { clearTimeout(drag.lp); if (drag.g === 'm') syncRows(true); } drag = null; });

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sel) { closeInspector(); return; }
    if (e.code === 'Space' && (!document.activeElement || document.activeElement === document.body)) {
        e.preventDefault();
        toggle();
    }
});

// Pastille d'état du chargement des sons de la mélodie
SeqAudio.onStatus(text => {
    const chip = $('audioStatus');
    chip.textContent = text;
    chip.hidden = !text;
});

/* ---------- Démarrage ---------- */
load();
refreshRows();
Object.keys(state.snd).forEach(k => SeqAudio.setSound(k, state.snd[k]));
SeqAudio.setDrumVolume(state.drumVol / 100);
SeqAudio.setMelodyVolume(state.melVol / 100);
DRUMS.forEach(d => SeqAudio.setTrackVolume(d.id, state.vol[d.id] / 100));
SeqAudio.setTimbre(state.timbre);
SeqAudio.want(state.mel.flat(2).filter(Boolean));    // charge les échantillons des instruments déjà posés
buildAll();
renderAll();
updatePlayUI();
setEditing(false);
})();
