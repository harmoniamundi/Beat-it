// fm-synth.js — synthèse FM à 6 opérateurs, dans l'esprit d'un DX7 (et de l'appli KQ Dixie qui l'imite).
//
// Un « patch » décrit un son : un algorithme (32 manières de brancher 6 opérateurs les uns sur les autres), des opérateurs
// (fréquence, niveau, enveloppe à 4 vitesses / 4 niveaux, échelle de clavier, sensibilité à la force de jeu), un LFO,
// une enveloppe de hauteur et un retour (feedback). FMSynth.render() calcule une note entière dans un tableau de
// nombres (Float32Array) ; audio-engine.js le rejoue ensuite comme un petit échantillon. Aucun accès au DOM.
//
// Unités du DX7 gardées telles quelles : niveaux et vitesses de 0 à 99 ; un niveau « log » vaut 0,75 dB (8 par octave
// d'amplitude), donc ajouter 8 à un niveau double l'amplitude du son.

const FMSynth = (() => {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const int = (v, a, b, d) => (Number.isFinite(v) ? clamp(Math.round(v), a, b) : d);

    /* ---------- Algorithmes ---------- */
    // « C » : opérateurs qui font du son ; « a>b » : a module b ; « F » : retour (feedback) de a vers b.
    // Toujours des modulateurs de numéro plus grand que leur cible (sauf le retour croisé), comme sur le DX7.
    const ALGO_SPEC = [
        'C1,3 2>1 6>5 5>4 4>3 F6>6',        // 1
        'C1,3 2>1 6>5 5>4 4>3 F2>2',        // 2
        'C1,4 3>2 2>1 6>5 5>4 F6>6',        // 3
        'C1,4 3>2 2>1 6>5 5>4 F4>6',        // 4
        'C1,3,5 2>1 4>3 6>5 F6>6',          // 5
        'C1,3,5 2>1 4>3 6>5 F5>6',          // 6
        'C1,3 2>1 6>5 5>3 4>3 F6>6',        // 7
        'C1,3 2>1 6>5 5>3 4>3 F4>4',        // 8
        'C1,3 2>1 6>5 5>3 4>3 F2>2',        // 9
        'C1,4 3>2 2>1 6>4 5>4 F3>3',        // 10
        'C1,4 3>2 2>1 6>4 5>4 F6>6',        // 11
        'C1,3 2>1 4>3 5>3 6>3 F2>2',        // 12
        'C1,3 2>1 4>3 5>3 6>3 F6>6',        // 13
        'C1,3 2>1 6>5 6>4 5>3 4>3 F6>6',    // 14
        'C1,3 2>1 6>5 6>4 5>3 4>3 F2>2',    // 15
        'C1 2>1 3>1 5>1 4>3 6>5 F6>6',      // 16
        'C1 2>1 3>1 5>1 4>3 6>5 F2>2',      // 17
        'C1 2>1 3>1 4>1 5>4 6>5 F3>3',      // 18
        'C1,4,5 3>2 2>1 6>4 6>5 F6>6',      // 19
        'C1,2,4 3>1 3>2 6>5 5>4 F3>3',      // 20
        'C1,2,4,5 3>1 3>2 6>4 6>5 F3>3',    // 21
        'C1,3,4,5 2>1 6>3 6>4 6>5 F6>6',    // 22
        'C1,2,4,5 3>2 6>4 6>5 F6>6',        // 23
        'C1,2,3,4,5 6>3 6>4 6>5 F6>6',      // 24
        'C1,2,3,4,5 6>4 6>5 F6>6',          // 25
        'C1,2,4 3>2 6>4 5>4 F6>6',          // 26
        'C1,2,4 3>2 6>4 5>4 F3>3',          // 27
        'C1,3,6 2>1 5>4 4>3 F5>5',          // 28
        'C1,2,3,5 4>3 6>5 F6>6',            // 29
        'C1,2,3,6 5>4 4>3 F5>5',            // 30
        'C1,2,3,4,5 6>5 F6>6',              // 31
        'C1,2,3,4,5,6 F6>6'                 // 32
    ];
    // Numéros d'opérateurs de 0 à 5 (OP1 = 0) : car = qui sonne · mods[i] = qui module i · fb = [source, destination]
    const ALGOS = ALGO_SPEC.map((s) => {
        const a = { car: [], mods: [[], [], [], [], [], []], fb: [5, 5], edges: [] };
        s.split(' ').forEach((tok) => {
            if (tok[0] === 'C') a.car = tok.slice(1).split(',').map((n) => +n - 1);
            else if (tok[0] === 'F') { const m = tok.slice(1).split('>'); a.fb = [+m[0] - 1, +m[1] - 1]; }
            else { const m = tok.split('>'); a.mods[+m[1] - 1].push(+m[0] - 1); a.edges.push([+m[0] - 1, +m[1] - 1]); }
        });
        return a;
    });

    /* ---------- Tables du DX7 ---------- */
    const LEVEL_LUT = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];
    const scaleOut = (l) => (l >= 20 ? l + 28 : LEVEL_LUT[l]);            // niveau 0–99 → échelle log 0–127
    const EXP_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 27, 33, 39, 47, 56, 66, 80, 94, 110, 126, 142,
        158, 174, 190, 206, 222, 238, 250];
    const PMS_OCT = [0, 0.0264, 0.0534, 0.0889, 0.1612, 0.2769, 0.4967, 1];  // vibrato : déviation maximale (octaves) à PMD 99
    const AMS_DEPTH = [0, 0.25, 0.5, 1];
    const LFO_WAVES = ['Triangle', 'Dent de scie ↓', 'Dent de scie ↑', 'Carré', 'Sinus', 'Aléatoire'];
    const CURVES = ['−lin', '−exp', '+exp', '+lin'];

    const SINE_N = 4096;
    const SINE = new Float32Array(SINE_N + 1);
    for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin(TAU * i / SINE_N);

    /* ---------- Patch ---------- */
    const initOp = (n) => ({
        on: 1, mode: 0, coarse: 1, fine: 0, det: 0, lvl: n === 0 ? 99 : 0,
        r: [99, 99, 99, 99], l: [99, 99, 99, 0],
        bp: 39, ld: 0, rd: 0, lc: 0, rc: 0, rs: 0, ams: 0, kvs: 0
    });
    const initPatch = () => ({
        algo: 1, fb: 0, mid: 60, sync: 1,
        lfo: { wave: 0, speed: 35, delay: 0, sync: 1, pmd: 0, amd: 0, pms: 0 },
        peg: { r: [99, 99, 99, 99], l: [50, 50, 50, 50] },
        ops: [0, 1, 2, 3, 4, 5].map(initOp)
    });
    const clone = (o) => JSON.parse(JSON.stringify(o));

    // Bornes de chaque réglage (utilisées par la remise en ordre ci-dessous et par l'éditeur).
    const RANGE = {
        algo: [1, 32], fb: [0, 7], mid: [36, 84],
        speed: [0, 99], delay: [0, 99], pmd: [0, 99], amd: [0, 99], pms: [0, 7], wave: [0, 5],
        coarse: [0, 31], fine: [0, 99], det: [-7, 7], lvl: [0, 99], rate: [0, 99], level: [0, 99],
        bp: [0, 99], depth: [0, 99], curve: [0, 3], rs: [0, 7], ams: [0, 3], kvs: [0, 7]
    };
    const arr4 = (a, d, lo, hi) => [0, 1, 2, 3].map((i) => int(a && a[i], lo, hi, d[i]));

    // Remet n'importe quel objet (sauvegarde ancienne, fichier importé…) en patch complet et valide.
    function cleanPatch(o) {
        const d = initPatch();
        if (!o || typeof o !== 'object') return d;
        const p = {
            algo: int(o.algo, 1, 32, d.algo), fb: int(o.fb, 0, 7, d.fb), mid: int(o.mid, 36, 84, d.mid),
            sync: o.sync === 0 || o.sync === false ? 0 : 1
        };
        const f = o.lfo || {};
        p.lfo = {
            wave: int(f.wave, 0, 5, 0), speed: int(f.speed, 0, 99, d.lfo.speed), delay: int(f.delay, 0, 99, 0),
            sync: f.sync === 0 || f.sync === false ? 0 : 1, pmd: int(f.pmd, 0, 99, 0), amd: int(f.amd, 0, 99, 0), pms: int(f.pms, 0, 7, 0)
        };
        const g = o.peg || {};
        p.peg = { r: arr4(g.r, d.peg.r, 0, 99), l: arr4(g.l, d.peg.l, 0, 99) };
        p.ops = d.ops.map((dop, i) => {
            const s = (o.ops && o.ops[i]) || {};
            return {
                on: s.on === 0 || s.on === false ? 0 : 1, mode: s.mode === 1 ? 1 : 0,
                coarse: int(s.coarse, 0, 31, dop.coarse), fine: int(s.fine, 0, 99, 0), det: int(s.det, -7, 7, 0),
                lvl: int(s.lvl, 0, 99, dop.lvl), r: arr4(s.r, dop.r, 0, 99), l: arr4(s.l, dop.l, 0, 99),
                bp: int(s.bp, 0, 99, 39), ld: int(s.ld, 0, 99, 0), rd: int(s.rd, 0, 99, 0),
                lc: int(s.lc, 0, 3, 0), rc: int(s.rc, 0, 3, 0), rs: int(s.rs, 0, 7, 0),
                ams: int(s.ams, 0, 3, 0), kvs: int(s.kvs, 0, 7, 0)
            };
        });
        return p;
    }

    /* ---------- Noms ---------- */
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 2);   // Do du milieu = C3 = 60
    const bpName = (bp) => noteName(bp + 21);                                                          // point de rupture 0–99 : A-1 … C8
    // Fréquence d'un opérateur, comme à l'écran du DX7 : « f×1.0-3 » (rapport) ou « 1621.81Hz » (fixe).
    function freqLabel(op) {
        if (op.mode === 1) return (Math.pow(10, (op.coarse & 3) + op.fine / 100)).toFixed(2) + 'Hz';
        return 'f×' + (op.coarse === 0 ? '0.5' : op.coarse + '.0') + (op.fine ? '-' + op.fine : '');
    }

    // Disposition d'un algorithme pour le dessiner : { nodes : [{ op, x, y }], edges, fb, rows, cols } (x, y en cases)
    function layout(algo) {
        const a = ALGOS[algo - 1];
        const targets = (i) => a.edges.filter((e) => e[0] === i).map((e) => e[1]);
        const depth = [], memo = {};
        const dep = (i) => {
            if (memo[i] != null) return memo[i];
            const t = targets(i);
            memo[i] = a.car.indexOf(i) >= 0 && !t.length ? 0 : 1 + Math.max.apply(null, t.map(dep).concat([-1]));
            return memo[i];
        };
        for (let i = 0; i < 6; i++) depth[i] = dep(i);
        const rows = Math.max.apply(null, depth) + 1;
        // Colonnes : chaque modulateur se range au-dessus de la première cible qui l'a pris ; un modulateur qui en
        // alimente plusieurs reste sous la première, les autres traits partent en diagonale.
        const kids = [[], [], [], [], [], []], seen = {};
        const visit = (i) => {
            seen[i] = 1;
            a.mods[i].slice().sort((p, q) => p - q).forEach((m) => { if (!seen[m]) { kids[i].push(m); visit(m); } });
        };
        const cars = a.car.slice().sort((p, q) => p - q);
        cars.forEach((i) => { if (!seen[i]) visit(i); });
        for (let i = 0; i < 6; i++) if (!seen[i]) { cars.push(i); visit(i); }
        const wid = [];
        const wOf = (i) => { if (wid[i] == null) wid[i] = Math.max(1, kids[i].reduce((t, k) => t + wOf(k), 0)); return wid[i]; };
        const xs = [];
        const put = (i, left) => {
            xs[i] = left + wOf(i) / 2 - 0.5;
            let c = left;
            kids[i].forEach((k) => { put(k, c); c += wOf(k); });
        };
        let cols = 0;
        cars.forEach((i) => { put(i, cols); cols += wOf(i); });
        const nodes = [];
        for (let i = 0; i < 6; i++) nodes.push({ op: i, x: xs[i], y: rows - 1 - depth[i] });
        return { nodes, edges: a.edges, car: a.car, fb: a.fb, rows, cols };
    }

    /* ---------- Rendu d'une note ---------- */
    const BLK = 32;                 // les enveloppes et le LFO se mettent à jour tous les 32 échantillons
    const MAX_HOLD = 10;            // durée tenue maximale rendue (s)
    const MAX_REL = 6;              // relâchement maximal rendu (s)
    const OUT_GAIN = 0.5;

    // Vitesse d'une enveloppe (unités log par seconde) : double tous les 4 crans de vitesse ; la montée est plus rapide.
    const decSpeed = (q) => 0.19 * Math.pow(2, q / 4);
    // Niveau visé à chaque étage : 0, 1, 2 → L1, L2, L3 ; 3 = maintien sur L3 (touche tenue) ; 4 = relâchement vers L4
    const stageTarget = (tg, stage) => (stage < 3 ? tg[stage] : stage === 3 ? tg[2] : tg[3]);

    function render(patch, midi, dur, vel, sr) {
        const p = patch;
        dur = clamp(dur, 0.02, MAX_HOLD);
        vel = clamp(vel, 0.05, 1);
        const note = midi + (p.mid - 60);
        const baseHz = 440 * Math.pow(2, (note - 69) / 12);
        const alg = ALGOS[p.algo - 1];
        const dt = BLK / sr;
        const seed = (midi * 2654435761) >>> 0;
        const rnd = (n) => { let x = (seed + n * 374761393) >>> 0; x = ((x ^ (x >>> 13)) * 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

        // Réglages fixes de chaque opérateur pour cette note
        const op = [];
        for (let i = 0; i < 6; i++) {
            const o = p.ops[i];
            const hz = o.mode === 1 ? Math.pow(10, (o.coarse & 3) + o.fine / 100)
                : baseHz * (o.coarse === 0 ? 0.5 : o.coarse) * (1 + o.fine / 100);
            const inc = hz * Math.pow(2, o.det * 1.25 / 1200) / sr;
            // Échelle de clavier : atténue ou renforce le niveau de part et d'autre du point de rupture
            const off = note - (o.bp + 21);
            let kls = 0;
            const curve = (group, depth, c) => {
                let s;
                if (c === 0 || c === 3) s = (group * depth * 329) >> 12;
                else s = (depth * EXP_SCALE[Math.min(group, 32)]) >> 7;
                return c < 2 ? -s : s;
            };
            if (off >= 0) kls = curve(Math.floor((off + 1) / 3), o.rd, o.rc);
            else kls = curve(Math.floor((-off + 1) / 3), o.ld, o.lc);
            const vdelta = o.kvs ? 4.8 * o.kvs * Math.log2(vel) : 0;
            const qoff = (o.rs * clamp(Math.floor(note / 3) - 7, 0, 31)) >> 3;
            const lv = scaleOut(o.lvl);
            const tg = o.l.map(scaleOut);
            const sp = o.r.map((r) => decSpeed(clamp(Math.floor(r * 41 / 64) + qoff, 0, 63)));
            op.push({
                on: o.on && lv > 0, fixed: o.mode === 1, inc, base: lv - 127 + kls + vdelta, ams: AMS_DEPTH[o.ams],
                tg, sp, cur: tg[3], stage: 0, ph: p.sync ? 0 : rnd(i), amp: 0
            });
        }
        // Enveloppe de hauteur
        const peg = { tg: p.peg.l.map((l) => (l - 50) / 50 * 4), sp: p.peg.r.map((r) => 0.01 * Math.pow(2, r / 6.5)), stage: 0 };
        peg.cur = peg.tg[3];
        const pegActive = p.peg.l.some((l) => l !== 50);
        // LFO
        const lfo = p.lfo, lfoHz = 0.06 * Math.pow(50 / 0.06, lfo.speed / 99);
        const lfoDelay = Math.pow(lfo.delay / 99, 2) * 4;
        const lfoOn = (lfo.pmd > 0 && lfo.pms > 0) || lfo.amd > 0;
        const lfoPh0 = lfo.sync ? 0 : rnd(11);
        const pmDepth = PMS_OCT[lfo.pms] * lfo.pmd / 99, amDepth = lfo.amd / 99 * 64;
        const lfoVal = (ph, cyc) => {
            switch (lfo.wave) {
                case 0: return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
                case 1: return 1 - 2 * ph;
                case 2: return 2 * ph - 1;
                case 3: return ph < 0.5 ? 1 : -1;
                case 4: return Math.sin(TAU * ph);
                default: return rnd(100 + cyc) * 2 - 1;
            }
        };

        const fbAmt = p.fb > 0 ? 0.5 * Math.pow(2, p.fb - 7) : 0;
        const fbSrc = alg.fb[0], fbDst = alg.fb[1];
        const carriers = alg.car.filter((i) => op[i].on);
        const maxN = Math.ceil((dur + MAX_REL) * sr / BLK) * BLK;
        const out = new Float32Array(maxN);
        const o6 = new Float64Array(6), inc = new Float64Array(6), amp = new Float64Array(6), damp = new Float64Array(6);
        const mods = alg.mods.map((m) => m.filter((j) => op[j].on));
        let fb1 = 0, fb2 = 0, n = 0, released = false;
        const offBlock = Math.ceil(dur * sr / BLK);

        for (let b = 0; b * BLK < maxN; b++) {
            const t = b * dt;
            if (!released && b >= offBlock) {
                released = true;
                op.forEach((o) => { o.stage = 4; });
                peg.stage = 4;
            }
            // --- hauteur : enveloppe de hauteur + vibrato du LFO
            let oct = 0;
            if (pegActive) {
                const target = stageTarget(peg.tg, peg.stage), sp = peg.sp[Math.min(peg.stage, 3)];
                if (peg.cur < target) peg.cur = Math.min(target, peg.cur + sp * dt);
                else if (peg.cur > target) peg.cur = Math.max(target, peg.cur - sp * dt);
                if (peg.cur === target && peg.stage < 3) peg.stage++;
                oct += peg.cur;
            }
            let lfoV = 0;
            if (lfoOn) {
                const cyc = lfoPh0 + t * lfoHz, ph = cyc - Math.floor(cyc);
                const fade = lfoDelay > 0 ? clamp((t - lfoDelay) / (lfoDelay * 0.4 + 0.05), 0, 1) : 1;
                lfoV = lfoVal(ph, Math.floor(cyc)) * fade;
                oct += lfoV * pmDepth;
            }
            const pm = oct !== 0 ? Math.pow(2, oct) : 1;
            // --- enveloppes et niveaux des opérateurs
            let carMax = 0, allSettled = true;
            for (let i = 0; i < 6; i++) {
                const o = op[i];
                if (!o.on) { damp[i] = 0; amp[i] = 0; continue; }
                inc[i] = o.fixed ? o.inc : o.inc * pm;
                const target = stageTarget(o.tg, o.stage);
                const sp = o.sp[Math.min(o.stage, 3)] * (o.cur < target ? 4 : 1);
                if (o.cur < target) o.cur = Math.min(target, o.cur + sp * dt);
                else if (o.cur > target) o.cur = Math.max(target, o.cur - sp * dt);
                if (o.cur === target && o.stage < 3) o.stage++;
                let lg = o.base + o.cur;
                if (o.ams && lfoOn) lg -= (lfoV * 0.5 + 0.5) * amDepth * o.ams;
                const a1 = (o.cur <= 0 || lg <= 0) ? 0 : Math.pow(2, (lg - 127) / 8);
                damp[i] = (a1 - amp[i]) / BLK;
                if (alg.car.indexOf(i) >= 0 && a1 > carMax) carMax = a1;
                if (alg.car.indexOf(i) >= 0 && o.stage < 3) allSettled = false;
            }
            if (!carriers.length) return new Float32Array(BLK);
            // --- les 32 échantillons du bloc
            const end = Math.min(BLK, maxN - b * BLK);
            for (let k = 0; k < end; k++) {
                for (let i = 5; i >= 0; i--) {
                    const o = op[i];
                    if (!o.on) { o6[i] = 0; continue; }
                    let ph = o.ph + inc[i];
                    if (ph >= 1) ph -= 1;
                    o.ph = ph;
                    amp[i] += damp[i];
                    let m = 0;
                    const ml = mods[i];
                    for (let q = 0; q < ml.length; q++) m += o6[ml[q]];
                    if (i === fbDst && fbAmt) m += fbAmt * 0.5 * (fb1 + fb2);
                    let x = (ph + m) * SINE_N;
                    const fl = Math.floor(x);
                    const fr = x - fl;
                    let ix = fl % SINE_N;
                    if (ix < 0) ix += SINE_N;
                    o6[i] = (SINE[ix] + (SINE[ix + 1] - SINE[ix]) * fr) * amp[i];
                    if (i === fbSrc) { fb2 = fb1; fb1 = o6[i]; }
                }
                let y = 0;
                for (let q = 0; q < carriers.length; q++) y += o6[carriers[q]];
                out[b * BLK + k] = y * OUT_GAIN;
            }
            n = b * BLK + end;
            // Fin du son : relâchement fini, ou enveloppes arrivées au bout sans plus rien d'audible
            if ((released || allSettled) && carMax < 1e-5 && (released || b > 2)) break;
        }
        const len = Math.max(BLK, n);
        const res = out.slice(0, len);
        const fade = Math.min(len, 96);                       // petit fondu final : jamais de claquement
        for (let i = 0; i < fade; i++) res[len - 1 - i] *= i / fade;
        return res;
    }

    /* ---------- Patchs d'usine : les 12 instruments synthétisés ---------- */
    // Raccourci d'écriture : un opérateur à partir de ses réglages utiles, le reste vient de initOp().
    const O = (s) => Object.assign(initOp(1), s);
    const E = (r, l) => ({ r, l });
    const FACTORY = {};
    // Niveau général de chaque patch d'usine, en unités log (0,75 dB) retirées aux carriers : les 12 instruments
    // sonnent à peu près aussi fort (mesure : moyenne de |x| sur un Do de 0,5 s ≈ 0,045). Les nombres de niveau des
    // patchs ci-dessous sont donc ceux d'avant réglage ; les modulateurs ne bougent pas, le timbre reste le même.
    const TRIM = { organ: 25, guitar: 1, strings: 20, synthbass: 11, flute: 14, clarinet: 19, marimba: 11, vibes: 9,
        bells: 19, synth: 24, chip: 20, pad: 21 };
    const unscale = (v) => { if (v >= 48) return v - 28; let k = 0; while (k < 19 && LEVEL_LUT[k + 1] <= v) k++; return k; };
    function def(id, algo, fb, ops, extra) {
        const p = initPatch();
        p.algo = algo; p.fb = fb;
        for (let i = 0; i < 6; i++) p.ops[i] = Object.assign(initOp(1), { lvl: 0 }, ops[i] || {});
        Object.assign(p, extra || {});
        ALGOS[algo - 1].car.forEach((i) => {
            const o = p.ops[i];
            if (o.lvl > 0) o.lvl = clamp(unscale(scaleOut(o.lvl) - (TRIM[id] || 0)), 1, 99);
        });
        FACTORY[id] = cleanPatch(p);
    }
    const LFO_VIB = (speed, delay, pmd, pms) => ({ lfo: { wave: 4, speed, delay, sync: 0, pmd, amd: 0, pms } });

    // Orgue : tirettes 1, 2, 3, 4, 6, 8 (six carriers, aucune modulation)
    def('organ', 32, 0, [
        { coarse: 1, lvl: 99, r: [95, 99, 99, 78], l: [99, 99, 99, 0] },
        { coarse: 2, lvl: 96, r: [95, 99, 99, 78], l: [99, 99, 99, 0] },
        { coarse: 3, lvl: 91, r: [95, 99, 99, 78], l: [99, 99, 99, 0] },
        { coarse: 4, lvl: 85, r: [95, 99, 99, 78], l: [99, 99, 99, 0] },
        { coarse: 6, lvl: 79, r: [95, 99, 99, 78], l: [99, 99, 99, 0] },
        { coarse: 8, lvl: 72, r: [95, 99, 99, 78], l: [99, 99, 99, 0] }
    ]);
    // Guitare : trois paires carrier / modulateur dont la brillance retombe vite (corde pincée)
    def('guitar', 5, 4, [
        { coarse: 1, lvl: 97, r: [99, 52, 40, 75], l: [99, 40, 0, 0], rs: 3, kvs: 2 },
        { coarse: 1, lvl: 88, r: [99, 60, 50, 75], l: [99, 50, 25, 0], kvs: 3 },
        { coarse: 2, lvl: 82, r: [99, 60, 50, 75], l: [99, 30, 0, 0], rs: 3 },
        { coarse: 3, fine: 4, lvl: 80, r: [99, 68, 60, 75], l: [99, 35, 0, 0] },
        { coarse: 4, lvl: 66, r: [99, 70, 60, 75], l: [99, 10, 0, 0] },
        { coarse: 6, fine: 20, lvl: 64, r: [99, 80, 60, 75], l: [99, 0, 0, 0] }
    ]);
    // Cordes : trois voix désaccordées, un peu de retour pour le grain, vibrato lent
    def('strings', 5, 4, [
        { coarse: 1, det: -7, lvl: 90, r: [62, 99, 99, 64], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 80, r: [62, 99, 99, 64], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 90, r: [62, 99, 99, 64], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 80, r: [62, 99, 99, 64], l: [99, 99, 99, 0] },
        { coarse: 1, det: 7, lvl: 90, r: [62, 99, 99, 64], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 80, r: [62, 99, 99, 64], l: [99, 99, 99, 0] }
    ], Object.assign({ sync: 0 }, LFO_VIB(66, 30, 25, 3)));
    // Basse synthé : carrier + modulateur qui se calme, sous-octave pure
    def('synthbass', 5, 0, [
        { coarse: 1, lvl: 99, r: [99, 55, 99, 72], l: [99, 82, 82, 0] },
        { coarse: 1, lvl: 90, r: [99, 58, 40, 72], l: [99, 80, 72, 0] },
        { coarse: 0, lvl: 88, r: [99, 80, 99, 72], l: [99, 92, 92, 0] }
    ]);
    // Flûte : sinus presque pur, un souffle de 2e harmonique, vibrato qui s'installe
    def('flute', 5, 0, [
        { coarse: 1, lvl: 99, r: [68, 70, 99, 72], l: [99, 92, 92, 0] },
        { coarse: 1, lvl: 55, r: [68, 70, 99, 72], l: [99, 92, 92, 0] },
        { coarse: 2, lvl: 78, r: [68, 70, 99, 72], l: [99, 92, 92, 0] }
    ], LFO_VIB(65, 40, 12, 2));
    // Clarinette : modulateur à l'octave → harmoniques impaires
    def('clarinet', 5, 0, [
        { coarse: 1, lvl: 99, r: [72, 70, 99, 72], l: [99, 93, 93, 0] },
        { coarse: 2, lvl: 86, r: [75, 60, 99, 72], l: [99, 90, 90, 0] }
    ]);
    // Marimba : partiels 1, 4 et 9,9 qui s'éteignent à des vitesses différentes
    def('marimba', 5, 0, [
        { coarse: 1, lvl: 99, r: [99, 52, 99, 55], l: [99, 0, 0, 0] },
        { coarse: 4, lvl: 62, r: [99, 80, 99, 55], l: [99, 0, 0, 0] },
        { coarse: 4, lvl: 88, r: [99, 64, 99, 55], l: [99, 0, 0, 0] },
        {},
        { coarse: 9, fine: 90, lvl: 75, r: [99, 82, 99, 55], l: [99, 0, 0, 0] }
    ]);
    // Vibraphone : fondamentale longue, partiel 4, trémolo (LFO sur l'amplitude)
    def('vibes', 5, 0, [
        { coarse: 1, lvl: 99, ams: 2, r: [99, 44, 99, 50], l: [99, 0, 0, 0] },
        { coarse: 4, lvl: 60, r: [99, 85, 99, 50], l: [99, 0, 0, 0] },
        { coarse: 4, lvl: 84, ams: 2, r: [99, 56, 99, 50], l: [99, 0, 0, 0] }
    ], { lfo: { wave: 4, speed: 65, delay: 0, sync: 1, pmd: 0, amd: 55, pms: 0 } });
    // Carillon : modulateur à 3,5 dont l'éclat retombe, partiel 2 qui s'éteint plus tôt
    def('bells', 5, 0, [
        { coarse: 1, lvl: 99, r: [99, 42, 99, 50], l: [99, 0, 0, 0] },
        { coarse: 3, fine: 50, lvl: 85, r: [99, 49, 60, 50], l: [99, 40, 0, 0] },
        { coarse: 2, lvl: 87, r: [99, 54, 99, 50], l: [99, 0, 0, 0] },
        { coarse: 5, lvl: 60, r: [99, 60, 99, 50], l: [99, 0, 0, 0] }
    ]);
    // Synthé : deux voix désaccordées, une paire à retour qui donne le grain « dent de scie » et se ferme un peu
    def('synth', 5, 6, [
        { coarse: 1, det: -6, lvl: 80, r: [96, 99, 99, 75], l: [99, 99, 99, 0] },
        {},
        { coarse: 1, det: 6, lvl: 85, r: [96, 99, 99, 75], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 78, r: [96, 70, 99, 75], l: [99, 68, 68, 0] },
        { coarse: 1, lvl: 99, r: [96, 99, 99, 75], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 92, r: [96, 62, 99, 75], l: [99, 82, 82, 0] }
    ], { sync: 0 });
    // Chiptune : onde carrée par synthèse additive (harmoniques impaires en 1/n), enveloppe courte
    def('chip', 32, 0, [1, 3, 5, 7, 9, 11].map((c, i) => ({
        coarse: c, lvl: [99, 86, 80, 77, 74, 71][i], r: [99, 67, 99, 80], l: [99, 94, 94, 0]
    })), LFO_VIB(70, 55, 20, 2));
    // Nappe : trois voix désaccordées, attaque et relâchement lents
    def('pad', 5, 0, [
        { coarse: 1, det: -6, lvl: 92, r: [58, 99, 99, 62], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 62, r: [58, 99, 99, 62], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 92, r: [58, 99, 99, 62], l: [99, 99, 99, 0] },
        { coarse: 2, lvl: 55, r: [58, 99, 99, 62], l: [99, 99, 99, 0] },
        { coarse: 1, det: 6, lvl: 92, r: [58, 99, 99, 62], l: [99, 99, 99, 0] },
        { coarse: 1, lvl: 62, r: [58, 99, 99, 62], l: [99, 99, 99, 0] }
    ], { sync: 0, lfo: { wave: 0, speed: 40, delay: 0, sync: 0, pmd: 18, amd: 0, pms: 2 } });

    /* ---------- Réglages de sortie (page « param ») et enveloppe des échantillons ---------- */
    const initOut = () => ({ cut: 127, res: 0, drv: 0, dtime: 15, dfb: 40, dmix: 0, tune: 0, pan: 64, vol: 127 });
    const OUT_RANGE = { cut: [0, 127], res: [0, 99], drv: [0, 99], dtime: [0, 99], dfb: [0, 99], dmix: [0, 99], tune: [-99, 99], pan: [0, 127], vol: [0, 127] };
    function cleanOut(o) {
        const d = initOut();
        Object.keys(OUT_RANGE).forEach((k) => { d[k] = int(o && o[k], OUT_RANGE[k][0], OUT_RANGE[k][1], d[k]); });
        return d;
    }
    // Enveloppe des instruments à échantillons : attaque (s), descente (s), maintien (0–1), relâchement (s)
    const ENV_RANGE = [[0, 2], [0, 4], [0, 1], [0, 3]];
    const initEnv = () => [0, 0, 1, 0];
    function cleanEnv(a) {
        const d = initEnv();
        return d.map((v, i) => (a && Number.isFinite(a[i]) ? clamp(Math.round(a[i] * 1000) / 1000, ENV_RANGE[i][0], ENV_RANGE[i][1]) : v));
    }

    // Son par défaut d'un instrument : patch FM pour les 12 synthétisés, enveloppe pour les échantillons
    const isFm = (id) => !!FACTORY[id];
    function defaultSound(id) {
        return isFm(id) ? { fm: clone(FACTORY[id]), out: initOut() } : { env: initEnv(), out: initOut() };
    }
    function cleanSound(id, s) {
        const d = defaultSound(id);
        if (!s || typeof s !== 'object') return d;
        d.out = cleanOut(s.out);
        if (isFm(id)) d.fm = s.fm ? cleanPatch(s.fm) : d.fm; else d.env = cleanEnv(s.env);
        return d;
    }

    return {
        ALGOS, ALGO_SPEC, FACTORY, RANGE, OUT_RANGE, ENV_RANGE, LFO_WAVES, CURVES,
        initPatch, initOp, initOut, initEnv, cleanPatch, cleanOut, cleanEnv, cleanSound, defaultSound, isFm, clone,
        noteName, bpName, freqLabel, layout, render, scaleOut
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FMSynth };
}
