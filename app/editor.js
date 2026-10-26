// editor.js — éditeur de son de la mélodie, dans l'esprit de l'écran d'un synthé FM à 6 opérateurs (KQ Dixie / DX7).
// Quatre pages, comme les onglets du synthé :
//   cart  : patchs d'usine à charger dans l'instrument         edit  : algorithme, opérateurs, LFO, enveloppe de hauteur
//   param : filtre, delay, accord, panoramique, volume          setup : copier, importer / exporter, remise à zéro
// Les instruments à échantillons (piano, basse, trompette) n'ont pas de patch FM : « edit » y règle leur enveloppe.
// Le moteur de son est dans audio/fm-synth.js et audio-engine.js ; ce fichier ne touche qu'à l'interface.
//
// SoundEditor.init({ timbres, getSound(k), commit(k), replace(k, son), audition(midi, k), isPlaying(), select(k) })
// SoundEditor.open(k) ouvre l'éditeur sur l'instrument k.

const SoundEditor = (() => {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const FM = FMSynth;
    let deps = null, root = null, body = null, insRow = null, tabsRow = null, nameBtn = null, kbdEl = null;
    let cur = 'organ', page = 'edit', lastNote = 60, views = [], undoSnap = null, audT = 0;

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
    // Bouton rotatif : on le fait glisser verticalement (ou flèches / molette). pos 0–1 ↔ valeur grâce à from / to.
    function knob(label, get, set, o) {
        const wrap = h('div', 'sed-knob');
        const dial = h('div', 'sed-dial');
        dial.tabIndex = 0;
        dial.setAttribute('role', 'slider');
        dial.setAttribute('aria-label', label);
        dial.setAttribute('aria-valuemin', o.min);
        dial.setAttribute('aria-valuemax', o.max);
        const svg = s('svg', { viewBox: '0 0 44 44' });
        s('circle', { cx: 22, cy: 22, r: 17, class: 'kn-bg' }, svg);
        const arc = s('path', { class: 'kn-arc', fill: 'none' }, svg);
        const dot = s('line', { class: 'kn-dot' }, svg);
        const val = h('span', 'sed-kv');
        dial.append(svg, val);
        const toPos = o.to || ((v) => (v - o.min) / (o.max - o.min));
        const fromPos = o.from || ((p) => o.min + p * (o.max - o.min));
        const A0 = 135, A1 = 405;                                  // le cadran couvre 270°
        const pt = (a, r) => [22 + r * Math.cos(a * Math.PI / 180), 22 + r * Math.sin(a * Math.PI / 180)];
        const paint = () => {
            const v = get(), p = clamp(toPos(v), 0, 1), a = A0 + (A1 - A0) * p;
            const [x0, y0] = pt(A0, 20), [x1, y1] = pt(a, 20), [dx, dy] = pt(a, 10), [ex, ey] = pt(a, 16);
            arc.setAttribute('d', 'M' + x0 + ' ' + y0 + ' A20 20 0 ' + (a - A0 > 180 ? 1 : 0) + ' 1 ' + x1 + ' ' + y1);
            dot.setAttribute('x1', dx); dot.setAttribute('y1', dy); dot.setAttribute('x2', ex); dot.setAttribute('y2', ey);
            val.textContent = o.fmt ? o.fmt(v) : String(v);
            dial.setAttribute('aria-valuenow', v);
        };
        const put = (p) => {
            let v = fromPos(clamp(p, 0, 1));
            const st = o.step || 1;
            v = Math.round(v / st) * st;
            v = clamp(+v.toFixed(4), o.min, o.max);
            set(v); paint(); touch();
        };
        let drag = null;
        dial.addEventListener('pointerdown', (e) => {
            drag = { y: e.clientY, p: toPos(get()) };
            dial.setPointerCapture(e.pointerId);
            dial.focus();
            e.preventDefault();
        });
        dial.addEventListener('pointermove', (e) => { if (drag) put(drag.p + (drag.y - e.clientY) / (e.shiftKey ? 600 : 160)); });
        const end = () => { drag = null; };
        dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
        dial.addEventListener('wheel', (e) => { e.preventDefault(); put(toPos(get()) + (e.deltaY < 0 ? 1 : -1) * 0.02); }, { passive: false });
        dial.addEventListener('keydown', (e) => {
            const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
            if (!k) return;
            e.preventDefault();
            const st = o.step || 1;
            const v = clamp(get() + k * st, o.min, o.max);
            set(+v.toFixed(4)); paint(); touch();
        });
        paint();
        wrap.append(h('span', 'sed-l', label), dial);
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

    /* ---------- Pages ---------- */
    function pageEdit() {
        if (!isFm()) return pageEnv();
        const top = h('div', 'sed-grid sed-top3', [algoCard(), globalCard(), lfoCard(), pitchEnvCard()]);
        const ops = h('div', 'sed-grid sed-ops');
        for (let i = 0; i < 6; i++) ops.append(opCard(i));
        body.append(top, ops);
    }
    // Instruments à échantillons : enveloppe d'amplitude simple
    function pageEnv() {
        const e = () => snd().env;
        const c = card('enveloppe de l\'instrument');
        c.append(h('p', 'sed-note', 'Piano, basse et trompette sont des enregistrements : on règle leur enveloppe (attaque, descente, maintien, relâchement) ' +
            'et, sur la page « param », le filtre, le delay, l\'accord, le panoramique et le volume.'));
        const secs = (v) => (v < 0.095 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s');
        const mk = (label, i, to) => knob(label, () => e()[i], (v) => { e()[i] = v; }, {
            min: FM.ENV_RANGE[i][0], max: FM.ENV_RANGE[i][1], step: 0.005, fmt: to || secs,
            to: (v) => Math.sqrt((v - FM.ENV_RANGE[i][0]) / (FM.ENV_RANGE[i][1] - FM.ENV_RANGE[i][0])),
            from: (p) => FM.ENV_RANGE[i][0] + p * p * (FM.ENV_RANGE[i][1] - FM.ENV_RANGE[i][0])
        });
        const k = h('div', 'sed-knobs', [
            mk('attaque', 0), mk('descente', 1),
            knob('maintien', () => e()[2], (v) => { e()[2] = v; }, { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' }),
            mk('relâchement', 3)
        ]);
        c.append(k);
        body.append(h('div', 'sed-grid', [c]));
    }
    function pageParam() {
        const o = () => snd().out;
        const R = FM.OUT_RANGE;
        const kn = (label, key, extra) => knob(label, () => o()[key], (v) => { o()[key] = v; }, Object.assign({ min: R[key][0], max: R[key][1] }, extra || {}));
        const filter = card('filter', 'sed-par');
        filter.append(h('div', 'sed-knobs', [kn('cutoff', 'cut'), kn('resonance', 'res'), kn('overdrive', 'drv')]));
        const delay = card('delay', 'sed-par');
        delay.append(h('div', 'sed-knobs', [kn('time', 'dtime'), kn('feedback', 'dfb'), kn('mix', 'dmix')]),
            h('p', 'sed-note', 'Le delay se règle en temps réel, sans rapport avec le tempo.'));
        const ctl = card('controller', 'sed-par');
        ctl.append(h('div', 'sed-knobs', [
            kn('master tune', 'tune', { fmt: (v) => (v > 0 ? '+' : '') + v }),
            kn('pan', 'pan', { fmt: (v) => (v === 64 ? 'C' : v < 64 ? 'L' + (64 - v) : 'R' + (v - 64)) }),
            kn('volume', 'vol')
        ]), h('p', 'sed-note', 'Master tune : en centièmes de ton (±99). Ces réglages valent pour tout l\'instrument, dans la mélodie comme au clavier.'));
        body.append(h('div', 'sed-grid sed-pgrid', [filter, delay, ctl]));
    }
    function pageCart() {
        const c = card('patchs d\'usine');
        if (!isFm()) {
            c.append(h('p', 'sed-note', 'Cet instrument est un échantillon : il n\'a pas de patch FM à charger. Choisissez un instrument synthétisé en haut pour parcourir les patchs.'));
            body.append(h('div', 'sed-grid', [c]));
            return;
        }
        c.append(h('p', 'sed-note', 'Chargez un patch dans « ' + deps.timbres[cur].label + ' » : il remplace le patch actuel (les réglages de la page « param » restent). Vous pouvez ensuite le modifier à votre guise.'));
        const list = h('div', 'sed-cart');
        Object.keys(FM.FACTORY).forEach((k) => {
            const b = h('button', 'sed-cart-b', [h('i', 'sed-dot'), h('span', null, deps.timbres[k].label)]);
            b.type = 'button';
            b.firstChild.style.background = deps.timbres[k].color;
            b.addEventListener('click', () => {
                undoSnap = FM.clone(snd());
                snd().fm = FM.clone(FM.FACTORY[k]);
                touch();
                renderPage();
            });
            list.append(b);
        });
        c.append(list);
        if (undoSnap) {
            const u = h('button', 'btn-sm', '↶ Annuler le chargement');
            u.type = 'button';
            u.addEventListener('click', () => { deps.replace(cur, undoSnap); undoSnap = null; touch(); renderPage(); });
            c.append(u);
        }
        body.append(h('div', 'sed-grid', [c]));
    }
    function pageSetup() {
        const c = card('exporter / importer');
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
                deps.replace(cur, FM.cleanSound(cur, obj));
                touch();
                renderPage();
            } catch (e) { msg.textContent = 'Ce texte n\'est pas un son valide.'; }
        });
        c.append(h('p', 'sed-note', 'Le son de cet instrument en texte : gardez-le dans un fichier pour le retrouver, ou collez ici un son reçu.'), ta, h('div', 'sed-btns', [copy, apply]), msg);

        const c2 = card('copier et remettre à zéro');
        const target = h('select', 'sed-s');
        target.setAttribute('aria-label', 'Instrument à écraser');
        Object.keys(deps.timbres).filter((k) => k !== cur && FM.isFm(k) === isFm()).forEach((k) => { const op = h('option', null, deps.timbres[k].label); op.value = k; target.append(op); });
        const dup = h('button', 'btn-sm', 'Copier ce son vers →');
        dup.type = 'button';
        dup.addEventListener('click', () => {
            if (!target.value) return;
            const k = target.value;
            deps.replace(k, FM.cleanSound(k, FM.clone(snd())));
            deps.commit(k);
            msg2.textContent = 'Copié vers « ' + deps.timbres[k].label + ' ».';
        });
        const msg2 = h('p', 'sed-note', '');
        const reset = h('button', 'btn-sm', 'Revenir au son d\'usine de « ' + deps.timbres[cur].label + ' »');
        reset.type = 'button';
        reset.addEventListener('click', () => {
            undoSnap = FM.clone(snd());
            deps.replace(cur, FM.defaultSound(cur));
            touch();
            renderPage();
        });
        const init = h('button', 'btn-sm', 'Patch vide (un seul opérateur)');
        init.type = 'button';
        init.disabled = !isFm();
        init.addEventListener('click', () => {
            undoSnap = FM.clone(snd());
            snd().fm = FM.initPatch();
            touch();
            renderPage();
        });
        c2.append(h('div', 'sed-btns', [dup, target]), msg2, h('div', 'sed-btns', [reset, init]));
        if (undoSnap) {
            const u = h('button', 'btn-sm', '↶ Annuler');
            u.type = 'button';
            u.addEventListener('click', () => { deps.replace(cur, undoSnap); undoSnap = null; touch(); renderPage(); });
            c2.append(u);
        }
        body.append(h('div', 'sed-grid', [c, c2]));
    }

    const PAGES = [['cart', 'cart', pageCart], ['edit', 'edit', pageEdit], ['param', 'param', pageParam], ['setup', 'setup', pageSetup]];
    function renderPage() {
        views = [];
        body.textContent = '';
        root.style.setProperty('--ic', accent());
        PAGES.forEach((p) => { if (p[0] === page) p[2](); });
        views.forEach((f) => f());
        Array.prototype.forEach.call(tabsRow.querySelectorAll('.sed-tab'), (b) => b.setAttribute('aria-pressed', b.dataset.p === page ? 'true' : 'false'));
        Array.prototype.forEach.call(insRow.children, (b) => b.setAttribute('aria-checked', b.dataset.k === cur ? 'true' : 'false'));
        nameBtn.textContent = deps.timbres[cur].label;
        body.scrollTop = 0;
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
        tabsRow = h('div', 'sed-tabs');
        nameBtn = h('span', 'sed-name');
        tabsRow.append(nameBtn);
        PAGES.forEach((p) => {
            const b = h('button', 'sed-tab', p[1]);
            b.type = 'button';
            b.dataset.p = p[0];
            b.addEventListener('click', () => { page = p[0]; renderPage(); });
            tabsRow.append(b);
        });
        kbdEl = h('div', 'sed-kbd');
        kbdEl.setAttribute('aria-label', 'Clavier d\'essai');
        root.append(top, body, tabsRow, kbdEl);
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
        const first = root.querySelector('.sed-tab[aria-pressed="true"]') || root.querySelector('.insp-x');
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
