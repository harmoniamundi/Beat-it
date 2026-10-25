// sequencer.js — état, grilles, lecture et événements du Séquenceur pas à pas.
// Une mesure à 4 temps qui tourne en boucle : la batterie (9 pistes) et une mélodie (grille note × pas, sur la
// gamme choisie). Le son est dans audio-engine.js, les gammes dans theory.js.

(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAXSTEPS = 16, MAXROWS = 15;
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

const DIVS = [
    [8,  'Croches',  '2 par temps', 'Croches'],
    [12, 'Triolets', '3 par temps', 'Triolets de croches'],
    [16, 'Doubles',  '4 par temps', 'Doubles-croches']
];

const E8 = [0, 2, 4, 6, 8, 10, 12, 14];
const PRESETS = {
    rock:    { label: 'Rock',      bpm: 108, div: 16, swing: 0,  map: { kick: [0, 8, 10], snare: [4, 12], hat: E8 } },
    boombap: { label: 'Boom bap',  bpm: 90,  div: 16, swing: 30, map: { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], ohat: [14] } },
    house:   { label: 'House',     bpm: 124, div: 16, swing: 0,  map: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [1, 5, 9, 13], ohat: [2, 6, 10, 14] } },
    funk:    { label: 'Funk',      bpm: 100, div: 16, swing: 12, map: { kick: [0, 3, 6, 10], snare: [4, 12], hat: E8, ohat: [15] } },
    bossa:   { label: 'Bossa',     bpm: 118, div: 16, swing: 0,  map: { kick: [0, 6, 8, 14], rim: [0, 3, 6, 10, 13], hat: E8 } },
    jazz:    { label: 'Jazz',      bpm: 132, div: 12, swing: 0,  map: { ride: [0, 3, 5, 6, 9, 11], hat: [3, 9], kick: [0, 6] } },
    afro:    { label: 'Afro 12/8', bpm: 96,  div: 12, swing: 0,  map: { bell: [0, 2, 4, 5, 7, 9, 11], kick: [0, 6], tom: [3, 9] } }
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
const emptyMel = () => Array.from({ length: MAXROWS }, () => Array(MAXSTEPS).fill(0));
const mkMel = (notes) => {
    const m = emptyMel();
    notes.forEach(([step, row]) => { m[row][step] = 1; });
    return m;
};

/* ---------- État ---------- */
const state = {
    bpm: PRESETS.rock.bpm, swing: 0, div: 16, preset: 'rock',
    pat: mkPat(PRESETS.rock.map), mute: {}, solo: {}, vol: {}, drumVol: 80, melVol: 70,
    mel: mkMel(DEFAULT_RIFF), root: 'C', scale: 'pentMin', octave: 4, range: 1, timbre: 'piano'
};
DRUMS.forEach(d => { state.mute[d.id] = false; state.solo[d.id] = false; state.vol[d.id] = 80; });

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
        if (Number.isFinite(s.drumVol)) state.drumVol = clamp(Math.round(s.drumVol), 0, 100);
        if (Number.isFinite(s.melVol)) state.melVol = clamp(Math.round(s.melVol), 0, 100);
        DRUMS.forEach(d => {
            const a = s.pat && s.pat[d.id];
            if (Array.isArray(a)) state.pat[d.id] = Array.from({ length: MAXSTEPS }, (_, i) => (a[i] ? 1 : 0));
            if (s.vol && Number.isFinite(s.vol[d.id])) state.vol[d.id] = clamp(s.vol[d.id], 0, 100);
            state.mute[d.id] = !!(s.mute && s.mute[d.id]);
            state.solo[d.id] = !!(s.solo && s.solo[d.id]);
        });
        if (Array.isArray(s.mel)) {
            state.mel = Array.from({ length: MAXROWS }, (_, r) =>
                Array.from({ length: MAXSTEPS }, (_, i) => (s.mel[r] && s.mel[r][i] ? 1 : 0)));
        }
        if (Theory.ROOTS.indexOf(s.root) !== -1) state.root = s.root;
        if (Theory.SCALES.some(sc => sc.id === s.scale)) state.scale = s.scale;
        if ([2, 3, 4, 5].indexOf(s.octave) !== -1) state.octave = s.octave;
        if ([1, 2].indexOf(s.range) !== -1) state.range = s.range;
        if (SeqAudio.TIMBRES[s.timbre]) state.timbre = s.timbre;
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
let playing = false, curStep = 0, nextTime = 0, raf = 0, shown = -1;
const queue = [];
const stepDur = () => 60 / state.bpm / (state.div / 4);

function triggerStep(s, when, d) {
    DRUMS.forEach(dr => {
        if (state.pat[dr.id][s] && audible(dr.id)) SeqAudio.playDrum(dr.id, dr.drum, when);
    });
    for (let r = 0; r < rowsInfo.length; r++) {
        if (!state.mel[r][s]) continue;
        if (s > 0 && state.mel[r][s - 1]) continue;          // suite d'une note tenue : déjà jouée
        let len = 1;
        while (s + len < state.div && state.mel[r][s + len]) len++;
        SeqAudio.playNote(rowsInfo[r].midi, when, Math.max(0.06, len * d * (len > 1 ? 0.98 : 0.86)), 0.9);
    }
}

function schedule() {
    const t = SeqAudio.now();
    if (nextTime < t - 0.05) nextTime = t + 0.02;             // l'horloge a pris du retard : on se recale
    const horizon = t + 0.14;
    while (nextTime < horizon) {
        const s = curStep, d = stepDur();
        const lag = (state.div !== 12 && s % 2 === 1) ? (state.swing / 100) * 0.5 * d : 0;
        const when = nextTime + lag;
        triggerStep(s, when, d);
        queue.push({ step: s, time: when });
        if (queue.length > 96) queue.shift();
        nextTime += d;
        curStep = (curStep + 1) % state.div;
    }
}
const clock = makeClock(schedule, 25);

function draw() {
    if (!playing) return;
    const t = SeqAudio.now();
    let hit = null;
    while (queue.length && queue[0].time <= t) hit = queue.shift();
    if (hit && hit.step !== shown) { setNow(hit.step); flash(hit.step); }
    raf = requestAnimationFrame(draw);
}

function start() {
    if (!SeqAudio.init()) return;
    playing = true;
    curStep = 0;
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
let dBtns = [], dCols = [], dRows = [], leds = [], rcsD = [];
let mBtns = [], mCols = [], rcsM = [];

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
    dBtns = []; dRows = []; leds = [];
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
        th.append(nameBtn, m, s, vol);

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
}

function buildMelody() {
    const N = state.div, g = N / 4;
    melRowsEl.textContent = '';
    mBtns = [];
    mCols = Array.from({ length: N }, () => []);
    rcsM = buildRuler($('melRuler'));

    const frag = document.createDocumentFragment();
    for (let r = rowsInfo.length - 1; r >= 0; r--) {
        const info = rowsInfo[r];
        const row = el('div', 'mrow' + (info.isRoot ? ' root' : ''));
        row.dataset.r = r;

        const lab = el('button', 'mlabel');
        lab.type = 'button';
        lab.dataset.r = r;
        lab.setAttribute('aria-label', 'Écouter : ' + info.name + (info.isRoot ? info.octave : ''));
        const nn = el('span', 'nname', info.name);
        if (info.isRoot) nn.append(el('sup', 'oct', String(info.octave)));
        lab.append(el('span', 'deg', info.degree), nn);

        const steps = el('div', 'steps');
        mBtns[r] = [];
        for (let b = 0; b < 4; b++) {
            const grp = el('div', 'grp');
            for (let k = 0; k < g; k++) {
                const i = b * g + k;
                const sb = makeStep('m', r, i, N, info.name + info.octave, state.mel[r][i]);
                mBtns[r][i] = sb;
                mCols[i].push(sb);
                grp.append(sb);
            }
            steps.append(grp);
        }
        row.append(lab, steps);
        frag.append(row);
    }
    melRowsEl.append(frag);
}

function buildAll() {
    shown = -1;
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
    for (let r = 0; r < rowsInfo.length; r++) {
        for (let i = 0; i < N; i++) mBtns[r][i].setAttribute('aria-pressed', state.mel[r][i] ? 'true' : 'false');
    }
}
function refreshAudible() {
    dRows.forEach((row, i) => row.classList.toggle('silent', !audible(DRUMS[i].id)));
}

/* ---------- Tête de lecture ---------- */
function clearNow() {
    if (shown >= 0) {
        [dCols[shown], mCols[shown]].forEach(col => { if (col) col.forEach(b => b.classList.remove('now')); });
        [rcsD[shown], rcsM[shown]].forEach(c => { if (c) c.classList.remove('now'); });
    }
    shown = -1;
}
function setNow(step) {
    if (!dCols[step]) return;
    clearNow();
    dCols[step].forEach(b => b.classList.add('now'));
    mCols[step].forEach(b => b.classList.add('now'));
    if (rcsD[step]) rcsD[step].classList.add('now');
    if (rcsM[step]) rcsM[step].classList.add('now');
    shown = step;
}
function blink(ti) {
    const l = leds[ti];
    if (!l) return;
    l.classList.remove('on');
    void l.offsetWidth;
    l.classList.add('on');
}
function flash(step) {
    if (step >= state.div) return;
    DRUMS.forEach((dr, ti) => {
        if (state.pat[dr.id][step] && audible(dr.id)) blink(ti);
    });
}
function auditionDrum(ti) {
    if (!SeqAudio.init()) return;
    SeqAudio.playDrum(DRUMS[ti].id, DRUMS[ti].drum, SeqAudio.now() + 0.01);
    blink(ti);
}
function auditionNote(r) {
    if (!SeqAudio.init() || !rowsInfo[r]) return;
    SeqAudio.playNote(rowsInfo[r].midi, SeqAudio.now() + 0.01, 0.6, 0.9);
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
    $('selTimbre').value = state.timbre;
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

function apply(g, r, i, v) {
    const val = v ? 1 : 0;
    if (g === 'd') {
        const id = DRUMS[r].id;
        if (state.pat[id][i] === val) return;
        state.pat[id][i] = val;
        dBtns[r][i].setAttribute('aria-pressed', val ? 'true' : 'false');
        if (state.preset) { state.preset = ''; renderPreset(); }
        if (val && !playing) auditionDrum(r);
    } else {
        if (!mBtns[r] || state.mel[r][i] === val) return;
        state.mel[r][i] = val;
        mBtns[r][i].setAttribute('aria-pressed', val ? 'true' : 'false');
        if (val && !playing) auditionNote(r);
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
    const changed = state.div !== p.div;
    state.div = p.div;
    if (changed) {
        queue.length = 0;
        if (playing) curStep %= state.div;
        buildAll();
    } else {
        refreshDrumSteps();
    }
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
    DRUMS.forEach(dr => { state.pat[dr.id] = Array(MAXSTEPS).fill(0); });
    state.preset = '';
    refreshDrumSteps();
    renderPreset();
    save();
}

// Phrase au hasard : marche sur les lignes de la gamme (de proche en proche), plutôt sur les temps, avec des silences.
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
        m[pick][i] = 1;
        prev = pick;
    }
    state.mel = m;
    refreshMelSteps();
    save();
}
function clearMelody() {
    state.mel = emptyMel();
    refreshMelSteps();
    save();
}

function rebuildMelody() {
    refreshRows();
    buildMelody();
    clearNow();
    renderMelodyControls();
    save();
}

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
    Object.keys(SeqAudio.TIMBRES).forEach(k => {
        const o = el('option', null, SeqAudio.TIMBRES[k].label);
        o.value = k;
        $('selTimbre').append(o);
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
    if (playing) curStep %= d;
    buildAll();
    renderDiv();
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
$('drumClear').addEventListener('click', clearDrums);
$('melRand').addEventListener('click', randomMelody);
$('melClear').addEventListener('click', clearMelody);

$('selRoot').addEventListener('change', () => { state.root = $('selRoot').value; rebuildMelody(); });
$('selScale').addEventListener('change', () => { state.scale = $('selScale').value; rebuildMelody(); });
$('selOct').addEventListener('change', () => { state.octave = +$('selOct').value; rebuildMelody(); });
$('selRange').addEventListener('change', () => { state.range = +$('selRange').value; rebuildMelody(); });
$('selTimbre').addEventListener('change', () => {
    state.timbre = $('selTimbre').value;
    state.octave = SeqAudio.TIMBRES[state.timbre].oct;
    SeqAudio.setTimbre(state.timbre);
    rebuildMelody();
});

// Clics dans les grilles : noms de pistes, M / S, volumes, étiquettes de notes, pas (clavier)
mainEl.addEventListener('click', e => {
    const step = e.target.closest('.step');
    if (step) {
        if (e.detail === 0) {      // activation au clavier (la souris et le doigt passent par les événements « pointer »)
            const g = step.dataset.g, r = +step.dataset.r, i = +step.dataset.i;
            const cur = g === 'd' ? state.pat[DRUMS[r].id][i] : state.mel[r][i];
            apply(g, r, i, !cur);
        }
        return;
    }
    const lab = e.target.closest('.mlabel');
    if (lab) { auditionNote(+lab.dataset.r); return; }
    const row = e.target.closest('.track');
    if (!row) return;
    const ti = +row.dataset.t, id = DRUMS[ti].id;
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
mainEl.addEventListener('contextmenu', e => { if (e.target.closest('.step')) e.preventDefault(); });

// Activer ou peindre des pas : souris, doigt ou stylet. Au doigt, le pas ne change qu'au relâchement (pour pouvoir
// faire défiler la page) ; en glissant le long d'une ligne, on peint tous les pas traversés (cases voisines d'une
// ligne mélodique = une note tenue).
let drag = null;
mainEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('.step');
    if (!b) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    SeqAudio.init();
    const g = b.dataset.g, r = +b.dataset.r, i = +b.dataset.i;
    const cur = g === 'd' ? state.pat[DRUMS[r].id][i] : state.mel[r][i];
    drag = { g, r, start: i, value: !cur, applied: false };
    if (e.pointerType === 'mouse') {
        apply(g, r, i, drag.value);
        drag.applied = true;
    }
});
window.addEventListener('pointermove', e => {
    if (!drag) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const b = hit && hit.closest ? hit.closest('.step') : null;
    if (!b || b.dataset.g !== drag.g || +b.dataset.r !== drag.r) return;
    const i = +b.dataset.i;
    if (!drag.applied) {
        if (i === drag.start) return;
        apply(drag.g, drag.r, drag.start, drag.value);
        drag.applied = true;
    }
    apply(drag.g, drag.r, i, drag.value);
});
window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!drag.applied) apply(drag.g, drag.r, drag.start, drag.value);
    drag = null;
});
window.addEventListener('pointercancel', () => { drag = null; });

document.addEventListener('keydown', e => {
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
SeqAudio.setDrumVolume(state.drumVol / 100);
SeqAudio.setMelodyVolume(state.melVol / 100);
DRUMS.forEach(d => SeqAudio.setTrackVolume(d.id, state.vol[d.id] / 100));
SeqAudio.setTimbre(state.timbre);
buildAll();
renderAll();
updatePlayUI();
})();
