// editor.js — éditeur de son de la mélodie.
//
// Un seul écran, du plus simple au plus technique :
//   1. « Son » : les sons proposés pour l'instrument (nylon / acier, violon / violoncelle…) ; on touche, on entend.
//   2. Des curseurs en français, groupés par ce qu'ils font : forme de la note (attaque, relâchement), timbre (brillance,
//      grain), mouvement (vibrato, chorus), espace (écho, réverbération), niveau (volume, panoramique, accord).
//   3. « Réglages avancés » (repliés) : le détail du synthé (forme d'onde, voix, filtre, enveloppe), la durée et les
//      répétitions de l'écho, et — pour le son « Synthé FM » — l'éditeur complet à 6 opérateurs façon DX7.
// Un clavier d'essai et un bouton « Écouter » restent en bas.
// Le moteur de son est dans audio/ ; ce fichier ne touche qu'à l'interface.
//
// SoundEditor.init({ timbres, getSound(k), commit(k), replace(k, son), audition(midi, k, durée, délai), baseNote(k),
//                    isPlaying(), select(k), onClose() })
// SoundEditor.open(k) ouvre l'éditeur sur l'instrument k.

const SoundEditor = (() => {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const FM = FMSynth, Lib = SoundLib;
    let deps = null, root = null, body = null, insRow = null, nameEl = null, kbdEl = null, undoBtn = null;
    let cur = 'organ', lastNote = 60, views = [], undoSnap = null, audT = 0, advOpen = false;

    function h(tag, cls, content) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (content != null) {
            if (Array.isArray(content)) content.forEach((c) => c && e.append(c)); else e.append(content);
        }
        return e;
    }
    const svgNS = 'http://www.w3.org/2000/svg';
    function s(tag, attrs, parent) {
        const e = document.createElementNS(svgNS, tag);
        Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
        if (parent) parent.append(e);
        return e;
    }

    const snd = () => deps.getSound(cur);
    const fm = () => snd().fm;
    const isFm = () => !!snd().fm;
    const kindOf = () => Lib.voice(cur, snd().voice).kind;
    const accent = () => deps.timbres[cur].color;

    // Après chaque réglage : on enregistre, on rafraîchit ce qui en dépend, on fait entendre le résultat (un instant après).
    function touch() {
        deps.commit(cur);
        views.forEach((f) => f());
        clearTimeout(audT);
        audT = setTimeout(() => { if (!deps.isPlaying()) deps.audition(lastNote, cur); }, 280);
    }

    /* ---------- Composants ---------- */
    // Champ numérique : on tape, on tourne la molette, ou on fait glisser l'étiquette de haut en bas.
    function num(label, get, set, range, opt) {
        opt = opt || {};
        const wrap = h('label', 'sed-f' + (opt.cls ? ' ' + opt.cls : ''));
        const lab = h('span', 'sed-l', label);
        const inp = h('input', 'sed-n');
        inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = range[0]; inp.max = range[1]; inp.step = 1; inp.value = get();
        inp.setAttribute('aria-label', opt.aria || label);
        const put = (v) => { set(clamp(Math.round(v), range[0], range[1])); inp.value = get(); touch(); };
        inp.addEventListener('input', () => { const v = inp.valueAsNumber; if (Number.isFinite(v)) { set(clamp(Math.round(v), range[0], range[1])); touch(); } });
        inp.addEventListener('change', () => { inp.value = get(); });
        inp.addEventListener('wheel', (e) => {
            if (document.activeElement !== inp) return;
            e.preventDefault();
            put(get() + (e.deltaY < 0 ? 1 : -1));
        }, { passive: false });
        let drag = null;
        lab.addEventListener('pointerdown', (e) => {
            drag = { y: e.clientY, v: get() };
            lab.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        lab.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const span = range[1] - range[0];
            put(drag.v + (drag.y - e.clientY) / (span > 20 ? 3 : 14) * (e.shiftKey ? 5 : 1));
        });
        const end = () => { drag = null; };
        lab.addEventListener('pointerup', end); lab.addEventListener('pointercancel', end);
        wrap.append(lab, inp);
        views.push(() => { if (document.activeElement !== inp) inp.value = get(); });
        return wrap;
    }
    function sel(label, options, get, set, cls) {
        const wrap = h('label', 'sed-f ' + (cls || ''));
        const lab = h('span', 'sed-l', label);
        const sl = h('select', 'sed-s');
        sl.setAttribute('aria-label', label);
        options.forEach((o, i) => { const op = h('option', null, o[1]); op.value = o[0]; sl.append(op); });
        sl.value = get();
        sl.addEventListener('change', () => { set(+sl.value); touch(); });
        wrap.append(lab, sl);
        views.push(() => { sl.value = get(); });
        return wrap;
    }
    // Bouton à deux états (ON / OFF)
    function tog(label, get, set, cls) {
        const wrap = h('div', 'sed-f ' + (cls || ''));
        const b = h('button', 'sed-t');
        b.type = 'button';
        const paint = () => { b.textContent = get() ? 'ON' : 'OFF'; b.setAttribute('aria-pressed', get() ? 'true' : 'false'); };
        b.setAttribute('aria-label', label);
        b.addEventListener('click', () => { set(get() ? 0 : 1); paint(); touch(); });
        paint();
        wrap.append(h('span', 'sed-l', label), b);
        views.push(paint);
        return wrap;
    }
    // Bouton qui passe d'une valeur à la suivante (courbes de l'échelle de clavier, mode de fréquence)
    function cyc(label, labels, get, set, cls) {
        const wrap = h('div', 'sed-f ' + (cls || ''));
        const b = h('button', 'sed-t sed-cyc');
        b.type = 'button';
        b.setAttribute('aria-label', label);
        const paint = () => { b.textContent = labels[get()]; };
        b.addEventListener('click', () => { set((get() + 1) % labels.length); paint(); touch(); });
        paint();
        wrap.append(h('span', 'sed-l', label), b);
        views.push(paint);
        return wrap;
    }
    const card = (title, extra) => {
        const c = h('section', 'sed-card' + (extra ? ' ' + extra : ''));
        if (title) c.append(h('h3', 'sed-h', title));
        return c;
    };
    const row = (...kids) => h('div', 'sed-row', kids);

    /* ---------- Enveloppe : courbe qu'on peut saisir et déplacer ---------- */
    // Largeur d'un segment selon sa vitesse (rapide = court), sur une échelle qui garde les valeurs lisibles
    const segW = (r) => 14 + Math.pow(1 - r / 99, 0.6) * 31;
    const segR = (w) => Math.round(99 * (1 - Math.pow(clamp((w - 14) / 31, 0, 1), 1 / 0.6)));
    function envGraph(get, setR, setL, opt) {
        opt = opt || {};
        const W = 224, H = 92, TOP = 6, BOT = 86, HOLD = 22, X0 = 5;
        const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sed-env', 'aria-hidden': 'true' });
        const y = (l) => BOT - l / 99 * (BOT - TOP);
        if (opt.mid) s('line', { x1: 0, x2: W, y1: y(50), y2: y(50), class: 'env-mid' }, svg);
        const fill = s('polygon', { class: 'env-fill' }, svg);
        const line = s('polyline', { class: 'env-line', fill: 'none' }, svg);
        const hold = s('line', { class: 'env-hold' }, svg);
        const hs = [0, 1, 2, 3].map((i) => { const c = s('circle', { r: 5.5, class: 'env-h' }, svg); c.dataset.i = i; return c; });
        let pts = [];
        const draw = () => {
            const e = get();
            const p0 = [X0, y(e.l[3])];
            const p1 = [p0[0] + segW(e.r[0]), y(e.l[0])];
            const p2 = [p1[0] + segW(e.r[1]), y(e.l[1])];
            const p3 = [p2[0] + segW(e.r[2]), y(e.l[2])];
            const p3b = [p3[0] + HOLD, p3[1]];
            const p4 = [p3b[0] + segW(e.r[3]), y(e.l[3])];
            pts = [p0, p1, p2, p3, p3b, p4];
            const L = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
            line.setAttribute('points', L);
            fill.setAttribute('points', L + ' ' + p4[0] + ',' + BOT + ' ' + p0[0] + ',' + BOT);
            hold.setAttribute('x1', p3[0]); hold.setAttribute('x2', p3b[0]); hold.setAttribute('y1', p3[1]); hold.setAttribute('y2', p3[1]);
            [p1, p2, p3, p4].forEach((p, i) => { hs[i].setAttribute('cx', p[0]); hs[i].setAttribute('cy', p[1]); });
        };
        let drag = null;
        const at = (e) => {
            const r = svg.getBoundingClientRect();
            return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
        };
        svg.addEventListener('pointerdown', (e) => {
            const c = e.target.closest && e.target.closest('.env-h');
            if (!c) return;
            drag = +c.dataset.i;
            svg.setPointerCapture(e.pointerId);
            c.classList.add('on');
            e.preventDefault();
        });
        svg.addEventListener('pointermove', (e) => {
            if (drag == null) return;
            const [px, py] = at(e), i = drag;
            const prevX = i === 3 ? pts[4][0] : pts[i][0];                  // point précédent (le relâchement part du bout du maintien)
            setL(i, clamp(Math.round((BOT - py) / (BOT - TOP) * 99), 0, 99));
            setR(i, segR(px - prevX));
            touch();
        });
        const end = () => { drag = null; hs.forEach((c) => c.classList.remove('on')); };
        svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
        draw();
        views.push(draw);
        return svg;
    }
    // Les 8 champs R1–R4 et L1–L4 sous la courbe
    function envFields(getEnv) {
        const rr = h('div', 'sed-g4'), ll = h('div', 'sed-g4');
        for (let i = 0; i < 4; i++) {
            rr.append(num('R' + (i + 1), () => getEnv().r[i], (v) => { getEnv().r[i] = v; }, [0, 99]));
            ll.append(num('L' + (i + 1), () => getEnv().l[i], (v) => { getEnv().l[i] = v; }, [0, 99]));
        }
        return [rr, ll];
    }

    /* ---------- Algorithme ---------- */
    function algoCard() {
        const c = card(null, 'sed-algo');
        const head = h('div', 'sed-algo-h');
        const numEl = h('b', 'sed-algo-n');
        const prev = h('button', 'sed-step', '‹'), next = h('button', 'sed-step', '›');
        prev.type = next.type = 'button';
        prev.setAttribute('aria-label', 'Algorithme précédent'); next.setAttribute('aria-label', 'Algorithme suivant');
        const go = (d) => { fm().algo = (fm().algo - 1 + d + 32) % 32 + 1; touch(); };
        prev.addEventListener('click', () => go(-1)); next.addEventListener('click', () => go(1));
        head.append(h('span', 'sed-l', 'algorithme'), prev, numEl, next);
        const box = h('div', 'sed-algo-d');
        const paint = () => {
            numEl.textContent = fm().algo;
            box.textContent = '';
            const lay = FM.layout(fm().algo), CW = 34, CH = 30, BW = 24, BH = 19, PX = 14, PY = 12;
            const w = lay.cols * CW + PX * 2 + 10, hh = lay.rows * CH + PY * 2 + 6;
            const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + hh, class: 'sed-algo-svg', role: 'img', 'aria-label': 'Schéma de l\'algorithme ' + fm().algo });
            s('defs', {}, svg).innerHTML = '<marker id="sedArr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z" fill="currentColor"/></marker>';
            const pos = {};
            lay.nodes.forEach((n) => { pos[n.op] = [PX + n.x * CW + (CW - BW) / 2, PY + n.y * CH]; });
            lay.edges.forEach((e) => {
                const a = pos[e[0]], b = pos[e[1]];
                s('line', { x1: a[0] + BW / 2, y1: a[1] + BH, x2: b[0] + BW / 2, y2: b[1], class: 'al-e' }, svg);
            });
            lay.car.forEach((i) => { const a = pos[i]; s('line', { x1: a[0] + BW / 2, y1: a[1] + BH, x2: a[0] + BW / 2, y2: a[1] + BH + 8, class: 'al-e' }, svg); });
            const f = lay.fb, a = pos[f[0]], b = pos[f[1]];
            {
                const xr = Math.max(a[0], b[0]) + BW + 7;
                const d = f[0] === f[1]
                    ? 'M' + (a[0] + BW) + ' ' + (a[1] + 5) + ' H' + xr + ' V' + (a[1] - 7) + ' H' + (a[0] + BW / 2) + ' V' + (a[1] - 1)
                    : 'M' + (a[0] + BW) + ' ' + (a[1] + BH / 2) + ' H' + xr + ' V' + (b[1] + BH / 2) + ' H' + (b[0] + BW + 1);
                s('path', { d, class: 'al-fb', fill: 'none', 'marker-end': 'url(#sedArr)' }, svg);
            }
            lay.nodes.forEach((n) => {
                const p = pos[n.op], carrier = lay.car.indexOf(n.op) >= 0;
                const g = s('g', { class: 'al-n' + (carrier ? ' car' : '') + (fm().ops[n.op].on ? '' : ' off') }, svg);
                s('rect', { x: p[0], y: p[1], width: BW, height: BH, rx: 4 }, g);
                const t = s('text', { x: p[0] + BW / 2, y: p[1] + BH / 2 + 4.5, 'text-anchor': 'middle' }, g);
                t.textContent = n.op + 1;
            });
            box.append(svg);
        };
        c.append(head, box);
        views.push(paint);
        paint();
        return c;
    }

    function globalCard() {
        const c = card(null, 'sed-glob');
        const mids = [];
        for (let m = 36; m <= 84; m++) mids.push([m, FM.noteName(m)]);
        c.append(
            sel('do du milieu', mids, () => fm().mid, (v) => { fm().mid = v; }),
            num('feedback', () => fm().fb, (v) => { fm().fb = v; }, FM.RANGE.fb),
            tog('osc key sync', () => fm().sync, (v) => { fm().sync = v; })
        );
        return c;
    }

    function lfoCard() {
        const c = card('LFO');
        const f = () => fm().lfo;
        c.append(
            sel('forme', FM.LFO_WAVES.map((n, i) => [i, n]), () => f().wave, (v) => { f().wave = v; }, 'wide'),
            row(
                num('speed', () => f().speed, (v) => { f().speed = v; }, FM.RANGE.speed),
                num('delay', () => f().delay, (v) => { f().delay = v; }, FM.RANGE.delay),
                tog('sync', () => f().sync, (v) => { f().sync = v; })
            ),
            row(
                num('PMD', () => f().pmd, (v) => { f().pmd = v; }, FM.RANGE.pmd),
                num('AMD', () => f().amd, (v) => { f().amd = v; }, FM.RANGE.amd),
                num('PMS', () => f().pms, (v) => { f().pms = v; }, FM.RANGE.pms)
            )
        );
        return c;
    }

    function pitchEnvCard() {
        const c = card('enveloppe de hauteur');
        const g = () => fm().peg;
        c.append(envGraph(g, (i, v) => { g().r[i] = v; }, (i, v) => { g().l[i] = v; }, { mid: true }));
        envFields(g).forEach((r) => c.append(r));
        return c;
    }

    /* ---------- Opérateur ---------- */
    function opCard(i) {
        const o = () => fm().ops[i];
        const c = card(null, 'sed-op');
        const head = h('div', 'sed-op-h');
        const title = h('button', 'sed-op-t', 'OP' + (i + 1));
        title.type = 'button';
        title.setAttribute('aria-label', 'Opérateur ' + (i + 1) + ' : activer ou couper');
        title.addEventListener('click', () => { o().on = o().on ? 0 : 1; touch(); });
        const bars = h('span', 'sed-bars');
        for (let b = 0; b < 7; b++) bars.append(h('i'));
        head.append(title, bars);
        const freq = h('output', 'sed-freq');
        views.push(() => {
            const n = Math.round(o().lvl / 99 * 7);
            Array.prototype.forEach.call(bars.children, (el, b) => el.classList.toggle('on', b < n));
            c.classList.toggle('off', !o().on);
            title.setAttribute('aria-pressed', o().on ? 'true' : 'false');
            freq.textContent = FM.freqLabel(o());
        });
        const fbox = h('div', 'sed-box', [
            h('span', 'sed-l', 'frequency'), freq,
            row(
                cyc('mode', ['ratio', 'fixe'], () => o().mode, (v) => { o().mode = v; }),
                num('coarse', () => o().coarse, (v) => { o().coarse = v; }, FM.RANGE.coarse),
                num('fine', () => o().fine, (v) => { o().fine = v; }, FM.RANGE.fine),
                num('detune', () => o().det, (v) => { o().det = v; }, FM.RANGE.det)
            )
        ]);
        const kbd = h('div', 'sed-box', [
            h('span', 'sed-l', 'KBD scale'),
            row(
                cyc('courbe G', FM.CURVES, () => o().lc, (v) => { o().lc = v; }),
                sel('point', Array.from({ length: 100 }, (_, b) => [b, FM.bpName(b)]), () => o().bp, (v) => { o().bp = v; }),
                cyc('courbe D', FM.CURVES, () => o().rc, (v) => { o().rc = v; })
            ),
            row(
                num('L depth', () => o().ld, (v) => { o().ld = v; }, FM.RANGE.depth),
                num('rate', () => o().rs, (v) => { o().rs = v; }, FM.RANGE.rs),
                num('R depth', () => o().rd, (v) => { o().rd = v; }, FM.RANGE.depth)
            )
        ]);
        const sens = h('div', 'sed-box', [
            row(
                num('M sens', () => o().ams, (v) => { o().ams = v; }, FM.RANGE.ams),
                num('V sens', () => o().kvs, (v) => { o().kvs = v; }, FM.RANGE.kvs),
                num('level', () => o().lvl, (v) => { o().lvl = v; }, FM.RANGE.lvl, { cls: 'lvl' })
            )
        ]);
        c.append(head, h('div', 'sed-op-grid', [
            h('div', 'sed-op-env', [
                h('span', 'sed-l', 'envelope'),
                envGraph(o, (k, v) => { o().r[k] = v; }, (k, v) => { o().l[k] = v; }),
                ...envFields(o)
            ]),
            h('div', 'sed-op-side', [fbox, kbd])
        ]), sens);
        return c;
    }


    /* ---------- Curseurs à étiquettes (partie simple de l'éditeur) ---------- */
    const pct = (v, max) => Math.round(v / max * 100) + ' %';
    const dec1 = (x) => x.toFixed(1).replace('.', ',');
    const secs = (t) => (t < 0.095 ? Math.round(t * 1000) + ' ms' : t < 10 ? t.toFixed(2).replace('.', ',') + ' s' : Math.round(t) + ' s');
    const none = (fn) => (v) => (v === 0 ? 'aucun' : fn(v));
    // name : nom du réglage · lo / hi : ce qu'on obtient aux deux bouts · desc : une phrase pour comprendre · fmt : valeur affichée
    const OUTSL = {
        att:   { name: 'Attaque', lo: 'immédiate', hi: 'lente', desc: 'Vitesse à laquelle le son monte au début de la note.', fmt: (v) => secs(Lib.attSec(v)) },
        rel:   { name: 'Relâchement', lo: 'sec', hi: 'long', desc: 'Durée de l\'extinction quand la note se termine.', fmt: (v) => secs(Lib.relSec(v)) },
        cut:   { name: 'Brillance', lo: 'sombre', hi: 'claire', desc: 'Adoucit le son ou le rend plus brillant.', fmt: (v) => (v >= 127 ? 'ouverte' : pct(v, 127)) },
        drv:   { name: 'Grain', lo: 'net', hi: 'saturé', desc: 'Ajoute de la chaleur, puis de la distorsion.', fmt: none((v) => v + ' %') },
        vib:   { name: 'Vibrato', lo: 'aucun', hi: 'marqué', desc: 'La hauteur ondule doucement, comme une voix ou un violon.', fmt: none((v) => v + ' %') },
        cho:   { name: 'Chorus', lo: 'seul', hi: 'épais', desc: 'Double le son avec un léger décalage : plus large, plus riche.', fmt: none((v) => v + ' %') },
        dmix:  { name: 'Écho', lo: 'aucun', hi: 'fort', desc: 'Répète le son en s\'estompant (durée et répétitions : réglages avancés).', fmt: none((v) => v + ' %') },
        rev:   { name: 'Réverbération', lo: 'sec', hi: 'salle', desc: 'Place le son dans une pièce plus ou moins grande.', fmt: none((v) => v + ' %') },
        vol:   { name: 'Volume', lo: 'bas', hi: 'fort', desc: 'Niveau de cet instrument (le mélangeur règle aussi son niveau).', fmt: (v) => pct(v, 127) },
        pan:   { name: 'Panoramique', lo: 'gauche', hi: 'droite', desc: 'Place l\'instrument entre les deux haut-parleurs.', fmt: (v) => (v === 64 ? 'centre' : v < 64 ? 'gauche ' + (64 - v) : 'droite ' + (v - 64)) },
        tune:  { name: 'Accord', lo: 'plus grave', hi: 'plus aigu', desc: 'Désaccorde légèrement, en centièmes de ton.', fmt: (v) => (v > 0 ? '+' : '') + v + ' ct' },
        res:   { name: 'Résonance du filtre', lo: 'douce', hi: 'perçante', desc: 'Accentue la région que « Brillance » vient de couper.', fmt: none((v) => v + ' %') },
        vrt:   { name: 'Vitesse du vibrato', lo: 'lent', hi: 'rapide', desc: 'Nombre d\'ondulations par seconde.', fmt: (v) => dec1(Lib.vibHz(v)) + ' Hz' },
        dtime: { name: 'Durée de l\'écho', lo: 'court', hi: 'long', desc: 'Temps entre une note et sa répétition (indépendant du tempo).', fmt: (v) => secs(Lib.echoSec(v)) },
        dfb:   { name: 'Répétitions de l\'écho', lo: 'une', hi: 'beaucoup', desc: 'Combien de fois l\'écho se répète.', fmt: (v) => v + ' %' }
    };
    const SYNSL = {
        pw:   { name: 'Largeur de l\'impulsion', lo: 'étroite', hi: 'carrée', desc: 'Une impulsion étroite sonne nasale, une large sonne creuse.', fmt: (v) => v + ' %' },
        det:  { name: 'Désaccord des voix', lo: 'unisson', hi: 'large', desc: 'Écart entre les voix superposées : plus il est grand, plus le son est large.', fmt: (v) => v + ' ct' },
        sub:  { name: 'Sous-octave', lo: 'aucune', hi: 'forte', desc: 'Ajoute une note une octave plus bas, pour le poids.', fmt: none((v) => v + ' %') },
        fc:   { name: 'Filtre : ouverture', lo: 'fermé', hi: 'ouvert', desc: 'Plus le filtre est ouvert, plus le son est brillant (suit la hauteur de la note).', fmt: (v) => pct(v, 99) },
        q:    { name: 'Filtre : résonance', lo: 'douce', hi: 'perçante', desc: 'Accentue la fréquence de coupure : son plus « vocal » ou « acide ».', fmt: none((v) => v + ' %') },
        fenv: { name: 'Filtre : ouverture au départ', lo: 'aucune', hi: 'forte', desc: 'Le filtre s\'ouvre à chaque attaque puis se referme : l\'effet « wow ».', fmt: none((v) => v + ' %') },
        fdec: { name: 'Filtre : durée de cette fermeture', lo: 'brève', hi: 'longue', desc: 'Temps que met le filtre à se refermer.', fmt: (v) => secs(Lib.decSec(v)) },
        dec:  { name: 'Descente', lo: 'rapide', hi: 'lente', desc: 'Temps que met le volume pour redescendre au « niveau tenu ».', fmt: (v) => secs(Lib.decSec(v)) },
        sus:  { name: 'Niveau tenu', lo: 'rien', hi: 'plein', desc: 'Volume pendant que la note est tenue (0 : note qui s\'éteint toute seule).', fmt: (v) => pct(v, 99) }
    };

    // Valeur « d'origine » d'un réglage pour le son choisi (double-clic sur le curseur)
    const originalOf = (src, key) => {
        const o = Lib.withVoice(cur, null, snd().voice);
        return (src === 'syn' ? o.syn : o.out)[key];
    };

    function slider(src, key) {
        const spec = (src === 'syn' ? SYNSL : OUTSL)[key], R = (src === 'syn' ? Lib.SYN : Lib.OUT)[key];
        const bag = () => (src === 'syn' ? snd().syn : snd().out);
        const wrap = h('label', 'sed-sl');
        const val = h('output', 'sed-sl-val');
        const inp = h('input', 'rng sed-rng');
        inp.type = 'range'; inp.min = R[0]; inp.max = R[1]; inp.step = 1;
        inp.setAttribute('aria-label', spec.name);
        inp.title = 'Double-clic : valeur d\'origine du son';
        const paint = () => {
            const v = bag()[key];
            if (+inp.value !== v) inp.value = v;
            inp.style.setProperty('--sl-p', String((v - R[0]) / (R[1] - R[0])));
            val.textContent = spec.fmt(v);
            inp.setAttribute('aria-valuetext', spec.fmt(v));
        };
        inp.addEventListener('input', () => { bag()[key] = +inp.value; touch(); });
        inp.addEventListener('dblclick', () => { bag()[key] = originalOf(src, key); touch(); });
        wrap.append(
            h('span', 'sed-sl-top', [h('span', 'sed-sl-name', spec.name), val]),
            inp,
            h('span', 'sed-sl-ends', [h('span', null, spec.lo), h('span', null, spec.hi)]),
            h('span', 'sed-sl-desc', spec.desc)
        );
        views.push(paint);
        return wrap;
    }
    // Choix parmi quelques valeurs (forme d'onde, nombre de voix)
    function choice(label, desc, items, get, set) {
        const wrap = h('div', 'sed-sl');
        const seg = h('div', 'seg sed-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', label);
        const btns = items.map((it) => {
            const b = h('button', null, it[1]);
            b.type = 'button';
            b.addEventListener('click', () => { set(it[0]); touch(); });
            seg.append(b);
            return [it[0], b];
        });
        views.push(() => btns.forEach((p) => { p[1].classList.toggle('on', p[0] === get()); p[1].setAttribute('aria-pressed', p[0] === get() ? 'true' : 'false'); }));
        wrap.append(h('span', 'sed-sl-top', h('span', 'sed-sl-name', label)), seg, h('span', 'sed-sl-desc', desc));
        return wrap;
    }

    /* ---------- Choix du son ---------- */
    const KIND_LABEL = { sf: 'Échantillon', bank: 'Échantillon', synth: 'Synthé', fm: 'FM · DX7' };
    function pickVoice(id) {
        if (id === snd().voice) { touch(); return; }
        undoSnap = FM.clone(snd());
        deps.replace(cur, Lib.withVoice(cur, snd(), id));
        views = [];                                  // les anciens curseurs ne correspondent plus au nouveau son
        touch();
        renderPage();
    }
    function voicesCard() {
        const list = Lib.voiceList(cur);
        const c = card('Son');
        const grid = h('div', 'sed-voices');
        grid.setAttribute('role', 'radiogroup');
        grid.setAttribute('aria-label', 'Son de ' + deps.timbres[cur].label);
        list.forEach((v) => {
            const b = h('button', 'sed-voice' + (v.kind === 'fm' ? ' adv' : ''), [h('span', 'sed-voice-n', v.label), h('span', 'sed-voice-k', KIND_LABEL[v.kind])]);
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', v.id === snd().voice ? 'true' : 'false');
            b.addEventListener('click', () => pickVoice(v.id));
            grid.append(b);
        });
        c.append(grid);
        const k = kindOf();
        c.append(h('p', 'sed-note', k === 'fm'
            ? 'Synthèse FM à 6 opérateurs, façon DX7 : tous les réglages sont dans « Réglages avancés » plus bas.'
            : k === 'synth' ? 'Synthétiseur calculé par l\'appareil. Les réglages de forme d\'onde, de filtre et de voix sont dans « Réglages avancés ».'
                : 'Enregistrement d\'un vrai instrument. Touchez un autre son pour l\'essayer : les curseurs ci-dessous s\'adaptent.'));
        return c;
    }

    /* ---------- Forme de la note : la courbe suit les curseurs ---------- */
    function shapeCard() {
        const c = card('Forme de la note');
        const W = 320, H = 64, X0 = 6, Y0 = 58, Y1 = 8;
        const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sed-env sed-shape', 'aria-hidden': 'true' });
        const fill = s('polygon', { class: 'env-fill' }, svg);
        const off = s('line', { class: 'env-hold' }, svg);
        const line = s('polyline', { class: 'env-line', fill: 'none' }, svg);
        const y = (l) => Y0 - l * (Y0 - Y1);
        views.push(() => {
            const o = snd().out, syn = snd().syn;
            const wA = 5 + 70 * Math.sqrt(Lib.attSec(o.att) / 2.4), wR = 6 + 78 * Math.sqrt(Lib.relSec(o.rel) / 4), wH = 70;
            let wD = 0, lvl = 1;
            if (syn && syn.sus < 99) { wD = 5 + 56 * Math.sqrt(Lib.decSec(syn.dec) / 3); lvl = syn.sus / 99; }
            const x1 = X0 + wA, x2 = x1 + wD, x3 = x2 + wH, x4 = x3 + wR;
            const P = [[X0, y(0)], [x1, y(1)], [x2, y(lvl)], [x3, y(lvl)], [x4, y(0)]].map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1));
            line.setAttribute('points', P.join(' '));
            fill.setAttribute('points', P.join(' ') + ' ' + x4.toFixed(1) + ',' + Y0 + ' ' + X0 + ',' + Y0);
            off.setAttribute('x1', x3); off.setAttribute('x2', x3); off.setAttribute('y1', Y1 - 4); off.setAttribute('y2', Y0);
        });
        c.append(svg, h('p', 'sed-note sed-note-s', 'Le volume d\'une note : il monte (attaque), se tient, puis s\'éteint (relâchement) quand la case se termine — trait pointillé.'),
            slider('out', 'att'), slider('out', 'rel'));
        return c;
    }
    function fmShapeCard() {
        const c = card('Forme de la note');
        c.append(h('p', 'sed-note', 'En synthèse FM, la forme de la note est réglée opérateur par opérateur (enveloppes dans « Réglages avancés »). Les autres curseurs fonctionnent comme d\'habitude.'));
        return c;
    }

    function group(title, keys) {
        const kind = kindOf();
        const c = card(title);
        keys.forEach((k) => { if (Lib.applies(kind, k)) c.append(slider('out', k)); });
        return c.children.length > 1 ? c : null;
    }

    /* ---------- Réglages avancés ---------- */
    function synthCard() {
        const c = card('Synthétiseur');
        const f = () => snd().syn;
        c.append(
            choice('Forme d\'onde', 'La matière du son : la dent de scie est riche, le sinus pur, le carré creux.', Lib.WAVES, () => f().wave, (v) => { f().wave = v; renderAfter(); }),
            slider('syn', 'pw'),
            choice('Voix superposées', 'Plusieurs oscillateurs légèrement désaccordés : le son devient large et vivant.', [1, 2, 3, 4, 5].map((n) => [n, String(n)]), () => f().uni, (v) => { f().uni = v; }),
            slider('syn', 'det'), slider('syn', 'sub'),
            h('h4', 'sed-sub', 'Filtre'),
            slider('syn', 'fc'), slider('syn', 'q'), slider('syn', 'fenv'), slider('syn', 'fdec'),
            h('h4', 'sed-sub', 'Volume de la note'),
            slider('syn', 'dec'), slider('syn', 'sus')
        );
        // le réglage de largeur d'impulsion n'a de sens que pour « Impulsion »
        const pw = c.querySelectorAll('.sed-sl')[1];
        views.push(() => { pw.hidden = f().wave !== 'pulse'; });
        return c;
    }
    const renderAfter = () => { touch(); renderPage(); };

    function fineCard() {
        const kind = kindOf();
        const c = card('Réglages fins');
        ['res', 'vrt', 'dtime', 'dfb'].forEach((k) => { if (Lib.applies(kind, k)) c.append(slider('out', k)); });
        return c;
    }

    // Éditeur FM complet (le son « Synthé FM »)
    function fmEditor() {
        const wrap = h('div', 'sed-fm');
        wrap.append(h('h3', 'sed-h sed-h-big', 'Synthé FM à 6 opérateurs'),
            h('p', 'sed-note', 'Choisissez d\'abord un algorithme (la façon dont les 6 opérateurs se modulent), puis réglez chaque opérateur : sa fréquence (ratio), son niveau et son enveloppe. Les curseurs de « Forme » ne servent pas ici : l\'enveloppe est celle de chaque opérateur.'));
        wrap.append(h('div', 'sed-grid sed-top3', [algoCard(), globalCard(), lfoCard(), pitchEnvCard()]));
        const ops = h('div', 'sed-grid sed-ops');
        for (let i = 0; i < 6; i++) ops.append(opCard(i));
        wrap.append(ops);
        return wrap;
    }

    function toolsCard() {
        const c = card('Outils');
        const ta = h('textarea', 'sed-ta');
        ta.spellcheck = false;
        ta.setAttribute('aria-label', 'Son de l\'instrument, en texte');
        ta.value = JSON.stringify(snd());
        const msg = h('p', 'sed-note', '');
        const copy = h('button', 'btn-sm', 'Copier');
        const apply = h('button', 'btn-sm btn-gen', 'Appliquer ce texte');
        copy.type = apply.type = 'button';
        copy.addEventListener('click', () => {
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { /* ignoré */ }
            if (!ok && navigator.clipboard) navigator.clipboard.writeText(ta.value).then(() => { msg.textContent = 'Copié.'; }, () => { msg.textContent = 'Sélectionnez le texte et copiez-le à la main.'; });
            else msg.textContent = ok ? 'Copié.' : 'Sélectionnez le texte et copiez-le à la main.';
        });
        apply.addEventListener('click', () => {
            try {
                const obj = JSON.parse(ta.value);
                undoSnap = FM.clone(snd());
                deps.replace(cur, Lib.cleanSound(cur, obj));
                touch();
                renderPage();
            } catch (e) { msg.textContent = 'Ce texte n\'est pas un son valide.'; }
        });
        c.append(h('p', 'sed-note', 'Le son de cet instrument en texte : gardez-le dans un fichier pour le retrouver, ou collez ici un son reçu.'), ta, h('div', 'sed-btns', [copy, apply]), msg);
        if (isFm()) {
            const init = h('button', 'btn-sm', 'Patch FM vide (un seul opérateur)');
            init.type = 'button';
            init.addEventListener('click', () => {
                undoSnap = FM.clone(snd());
                snd().fm = FM.initPatch();
                touch();
                renderPage();
            });
            const fac = h('button', 'btn-sm', 'Patch FM d\'usine de « ' + deps.timbres[cur].label + ' »');
            fac.type = 'button';
            fac.addEventListener('click', () => {
                undoSnap = FM.clone(snd());
                snd().fm = FM.clone(FM.FACTORY[cur] || FM.initPatch());
                touch();
                renderPage();
            });
            c.append(h('div', 'sed-btns', [fac, init]));
        }
        return c;
    }

    function advancedPart() {
        const kind = kindOf();
        const det = h('details', 'sed-adv');
        det.open = advOpen || kind === 'fm';
        det.addEventListener('toggle', () => { advOpen = det.open; });
        det.append(h('summary', null, [h('span', null, 'Réglages avancés'),
            h('small', null, kind === 'synth' ? 'forme d\'onde, voix, filtre, enveloppe, écho…' : kind === 'fm' ? 'algorithme, opérateurs, LFO…' : 'résonance, vitesse du vibrato, écho…')]));
        const inner = h('div', 'sed-adv-in');
        const row = h('div', 'sed-grid sed-sl-grid');
        if (kind === 'synth') row.append(synthCard());
        row.append(fineCard(), toolsCard());
        inner.append(row);
        if (kind === 'fm') inner.append(fmEditor());
        det.append(inner);
        return det;
    }

    /* ---------- Page ---------- */
    function renderPage() {
        views = [];
        body.textContent = '';
        root.style.setProperty('--ic', accent());
        const kind = kindOf();
        body.append(voicesCard());
        const grid = h('div', 'sed-grid sed-sl-grid');
        [kind === 'fm' ? fmShapeCard() : shapeCard(), group('Timbre', ['cut', 'drv']), group('Mouvement', ['vib', 'cho']),
            group('Espace', ['dmix', 'rev']), group('Niveau', ['vol', 'pan', 'tune'])].forEach((c) => c && grid.append(c));
        body.append(grid, advancedPart());
        views.forEach((f) => f());
        Array.prototype.forEach.call(insRow.children, (b) => b.setAttribute('aria-checked', b.dataset.k === cur ? 'true' : 'false'));
        nameEl.textContent = deps.timbres[cur].label + ' · ' + Lib.voice(cur, snd().voice).label;
        undoBtn.hidden = !undoSnap;
        body.scrollTop = 0;
    }

    /* ---------- Écouter, remettre à zéro, annuler ---------- */
    function listen() {
        const base = deps.baseNote ? deps.baseNote(cur) : 60;
        [0, 4, 7, 12].forEach((d, i) => deps.audition(base + d, cur, i === 3 ? 1.6 : 0.34, i * 0.3));
    }
    function resetSound() {
        undoSnap = FM.clone(snd());
        deps.replace(cur, Lib.withVoice(cur, null, snd().voice));
        touch();
        renderPage();
    }
    function undoLast() {
        if (!undoSnap) return;
        deps.replace(cur, undoSnap);
        undoSnap = null;
        touch();
        renderPage();
    }

    /* ---------- Clavier d'essai ---------- */
    function buildKeyboard() {
        kbdEl.textContent = '';
        const BLACK = { 0: 1, 2: 1, 5: 1, 7: 1, 9: 1 };                // touche noire à droite de ces touches blanches (pour Do, Ré, Fa, Sol, La)
        for (let m = 36; m <= 83; m++) {
            const pc = m % 12;
            if ([1, 3, 6, 8, 10].indexOf(pc) >= 0) continue;
            const k = h('button', 'sed-k');
            k.type = 'button';
            k.dataset.m = m;
            k.setAttribute('aria-label', FM.noteName(m));
            if (pc === 0) k.append(h('span', 'sed-kn', FM.noteName(m)));
            if (BLACK[pc] && m < 83) {
                const b = h('span', 'sed-kb');
                b.dataset.m = m + 1;
                k.append(b);
            }
            kbdEl.append(k);
        }
    }
    function bindKeyboard() {
        let down = null;
        const noteOf = (e) => { const t = e.target.closest('[data-m]'); return t ? { el: t, m: +t.dataset.m } : null; };
        kbdEl.addEventListener('pointerdown', (e) => {
            const n = noteOf(e);
            if (!n) return;
            down = n.el;
            n.el.classList.add('dn');
            lastNote = n.m;
            deps.audition(n.m, cur);
            e.preventDefault();
        });
        const up = () => { if (down) down.classList.remove('dn'); down = null; };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    }

    /* ---------- Fenêtre ---------- */
    function build() {
        root = h('section', 'sed');
        root.id = 'sed';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Éditeur de son');
        root.hidden = true;
        const top = h('div', 'sed-top');
        insRow = h('div', 'sed-ins');
        insRow.setAttribute('role', 'radiogroup');
        insRow.setAttribute('aria-label', 'Instrument à éditer');
        Object.keys(deps.timbres).forEach((k) => {
            const d = deps.timbres[k];
            const b = h('button', 'ins', [h('i', 'dot'), h('span', null, d.label)]);
            b.type = 'button';
            b.dataset.k = k;
            b.setAttribute('role', 'radio');
            b.style.setProperty('--ic', d.color);
            b.addEventListener('click', () => { cur = k; undoSnap = null; if (deps.select) deps.select(k); renderPage(); });
            insRow.append(b);
        });
        const x = h('button', 'insp-x', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', 'Fermer l\'éditeur de son');
        x.addEventListener('click', close);
        top.append(insRow, x);
        body = h('div', 'sed-body');
        nameEl = h('span', 'sed-name');
        const play = h('button', 'btn-sm sed-play', [(() => {
            const i = s('svg', { width: 12, height: 12, viewBox: '0 0 14 14', fill: 'currentColor', 'aria-hidden': 'true' });
            s('path', { d: 'M3 1.5v11l9-5.5z' }, i);
            return i;
        })(), h('span', null, 'Écouter')]);
        play.type = 'button';
        play.addEventListener('click', listen);
        const reset = h('button', 'btn-sm', 'Réglages d\'origine');
        reset.type = 'button';
        reset.title = 'Remet tous les réglages du son choisi à leur valeur de départ';
        reset.addEventListener('click', resetSound);
        undoBtn = h('button', 'btn-sm', '↶ Annuler');
        undoBtn.type = 'button';
        undoBtn.hidden = true;
        undoBtn.addEventListener('click', undoLast);
        const foot = h('div', 'sed-foot', [nameEl, play, reset, undoBtn]);
        kbdEl = h('div', 'sed-kbd');
        kbdEl.setAttribute('aria-label', 'Clavier d\'essai');
        root.append(top, body, foot, kbdEl);
        document.body.append(root);
        buildKeyboard();
        bindKeyboard();
        root.addEventListener('keydown', (e) => {
            e.stopPropagation();                                       // la barre d'espace ne lance pas la lecture ici
            if (e.key === 'Escape') close();
        });
    }
    function open(k) {
        if (!root) build();
        if (k && deps.timbres[k]) cur = k;
        undoSnap = null;
        root.hidden = false;
        document.body.classList.add('sed-open');
        renderPage();
        kbdEl.scrollLeft = Math.max(0, kbdEl.scrollWidth * 0.25);
        const first = root.querySelector('.sed-voice[aria-checked="true"]') || root.querySelector('.insp-x');
        if (first) first.focus();
    }
    function close() {
        if (!root) return;
        root.hidden = true;
        document.body.classList.remove('sed-open');
        if (deps.onClose) deps.onClose();
    }
    function init(d) { deps = d; }
    const isOpen = () => !!root && !root.hidden;
    return { init, open, close, isOpen };
})();
