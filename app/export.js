// export.js — fenêtre « Exporter » du Séquenceur pas à pas : fichier audio WAV (le mix, ou une piste par fichier dans un .zip)
// et fichier MIDI (.mid).
//
// Principe : sequencer.js « joue » la mesure (ou la chanson) à blanc et note chaque coup (record) : instant, hauteur, force,
// instrument. Le même relevé sert ensuite à tout : le rendu audio hors ligne (chaque piste séparée rejoue exactement les mêmes
// coups, probabilités et humanisation comprises) et le fichier MIDI.
// Le rendu utilise un moteur son à part (SeqAudio.create) dans un OfflineAudioContext : il va plus vite que le temps réel,
// et ne dérange pas la lecture. Les pistes séparées sont rendues sans le compresseur général de l'appli, pour qu'on puisse
// les mixer librement ailleurs (le mix, lui, le garde).
//
// Exporter.init({ record({ bars, human }), engineOptions(), info() }) puis Exporter.open().
//   record → { events, bars, seconds, bpm, song } ; events : { k: 'd', track, drum, when, vel, fx } (batterie)
//   ou { k: 'n', midi, when, dur, vel, fx, key, trim } (note de la mélodie)

const Exporter = (() => {
    'use strict';

    const SR = 44100, TAIL = 2.5, MAX_SEC = 600, PPQ = 480;
    let deps = null, root = null, opener = null, busy = false;
    let bars = 4, bits = 24, fold = true;
    let msgEl, infoEl, loopBox, barsSeg, bitsSeg, foldChk, songNote, btnMix, btnStems, btnMidi;

    const h = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    };
    const btn = (label, cls, fn, title) => {
        const b = h('button', cls || 'btn-sm', label);
        b.type = 'button';
        if (title) b.title = title;
        b.addEventListener('click', fn);
        return b;
    };
    const slug = n => (n || 'sequenceur').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sequenceur';
    const fmtMo = n => (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : Math.round(n / 1048576)).toString().replace('.', ',') + ' Mo';
    const fmtSec = s => (s < 60 ? s.toFixed(1).replace('.', ',') + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s');
    const wait = ms => new Promise(r => setTimeout(r, ms));

    function say(text, bad) {
        if (!msgEl) return;
        msgEl.textContent = text || '';
        msgEl.classList.toggle('bad', !!bad);
    }
    function save(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = h('a');
        a.href = url;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 8000);
    }

    /* ---------- WAV ---------- */
    // Une paire de canaux → fichier WAV (16 ou 24 bits entiers, ou 32 bits flottants). En entiers, un son qui dépasserait 0 dB est
    // ramené juste en dessous (sinon il saturerait) ; renvoie aussi le crête d'origine pour avertir.
    function peakOf(l, r) {
        let p = 0;
        for (let i = 0; i < l.length; i++) { const a = Math.abs(l[i]), b = Math.abs(r[i]); if (a > p) p = a; if (b > p) p = b; }
        return p;
    }
    function encodeWav(l, r, nbits, limit) {
        const n = l.length, bytes = nbits / 8, dataLen = n * 2 * bytes;
        const buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
        const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
        str(12, 'fmt '); v.setUint32(16, 16, true);
        v.setUint16(20, nbits === 32 ? 3 : 1, true);           // 1 : entiers · 3 : flottants
        v.setUint16(22, 2, true); v.setUint32(24, SR, true);
        v.setUint32(28, SR * 2 * bytes, true); v.setUint16(32, 2 * bytes, true); v.setUint16(34, nbits, true);
        str(36, 'data'); v.setUint32(40, dataLen, true);
        const peak = peakOf(l, r);
        const g = (nbits < 32 && limit && peak > 0.999) ? 0.98 / peak : 1;
        let o = 44;
        for (let i = 0; i < n; i++) {
            for (let c = 0; c < 2; c++) {
                const x = (c ? r[i] : l[i]) * g;
                if (nbits === 32) { v.setFloat32(o, x, true); o += 4; continue; }
                const s = Math.max(-1, Math.min(1, x));
                if (nbits === 16) { v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true); o += 2; }
                else {
                    const q = Math.round(s < 0 ? s * 8388608 : s * 8388607);
                    v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3;
                }
            }
        }
        return { buf, peak, scaled: g < 1 };
    }

    /* ---------- ZIP (sans compression) ---------- */
    let crcTable = null;
    function crc32(u8) {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
        }
        let c = 0xFFFFFFFF;
        for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    // files : [{ name, data : ArrayBuffer }] → Blob .zip (noms en UTF-8)
    function zipBlob(files) {
        const enc = new TextEncoder(), parts = [], central = [], d = new Date();
        const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        let offset = 0;
        files.forEach(f => {
            const name = enc.encode(f.name), size = f.data.byteLength, crc = crc32(new Uint8Array(f.data));
            const loc = new DataView(new ArrayBuffer(30));
            loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
            loc.setUint16(10, dosTime, true); loc.setUint16(12, dosDate, true); loc.setUint32(14, crc, true);
            loc.setUint32(18, size, true); loc.setUint32(22, size, true); loc.setUint16(26, name.length, true); loc.setUint16(28, 0, true);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
            cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true);
            cen.setUint32(20, size, true); cen.setUint32(24, size, true); cen.setUint16(28, name.length, true);
            cen.setUint32(42, offset, true);
            parts.push(loc.buffer, name, f.data);
            central.push(cen.buffer, name);
            offset += 30 + name.length + size;
        });
        const cenSize = central.reduce((t, p) => t + p.byteLength, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
    }

    /* ---------- Rendu hors ligne ---------- */
    // Rejoue les coups `evs` dans un moteur neuf et renvoie les deux canaux. `shared` : échantillons déjà décodés (gardés le temps de l'export).
    async function render(rec, evs, shared, bypassComp) {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) throw new Error('Ce navigateur ne sait pas faire le rendu audio hors ligne.');
        const frames = Math.ceil((rec.seconds + TAIL) * SR);
        const ctx = new OAC(2, frames, SR);
        const eng = SeqAudio.create(Object.assign({ offline: true, banks: shared, bypassComp: !!bypassComp }, deps.engineOptions()));
        eng.init(ctx);
        eng.want(Array.from(new Set(evs.filter(e => e.k === 'n').map(e => e.key))));
        await eng.whenLoaded();
        evs.forEach(e => {
            if (e.k === 'd') eng.playDrum(e.track, e.drum, e.when, e.vel, e.fx);
            else eng.playNote(e.midi, e.when, e.dur, e.vel, e.fx, e.key, e.trim, e.legato);
        });
        const out = await ctx.startRendering();
        const l = out.getChannelData(0), r = out.getChannelData(out.numberOfChannels > 1 ? 1 : 0);
        return { l, r, frames };
    }
    // Boucle parfaite : ce qui sonne encore après la fin de la boucle (queues, échos) revient au début
    function foldTail(l, r, loopFrames) {
        for (let i = loopFrames; i < l.length; i++) { const j = i % loopFrames; l[j] += l[i]; r[j] += r[i]; }
        return { l: l.subarray(0, loopFrames), r: r.subarray(0, loopFrames) };
    }

    /* ---------- MIDI ---------- */
    const GM_DRUM = { kick: 36, snare: 38, rim: 37, hat: 42, ohat: 46, ride: 51, bell: 56, tom: 45, clave: 75 };
    const GM_PROG = { piano: 0, organ: 18, guitar: 24, strings: 48, bass: 33, synthbass: 38, trumpet: 56, flute: 73, clarinet: 71, marimba: 12, vibes: 11, bells: 14, synth: 80, chip: 81, pad: 89 };
    function vlq(n) {
        const out = [n & 127];
        while ((n >>= 7)) out.unshift((n & 127) | 128);
        return out;
    }
    function midiTrack(items, name) {         // items : [{ t (ticks), o (0 : note off, 1 : autre, 2 : note on), b : octets }]
        const enc = new TextEncoder(), nm = enc.encode(name), bytes = [0, 0xFF, 0x03, nm.length].concat(Array.from(nm));
        items.sort((a, b) => a.t - b.t || a.o - b.o);
        let last = 0;
        items.forEach(it => { bytes.push.apply(bytes, vlq(it.t - last)); bytes.push.apply(bytes, it.b); last = it.t; });
        bytes.push(0, 0xFF, 0x2F, 0);
        const head = new Uint8Array(8), dv = new DataView(head.buffer);
        head.set([0x4D, 0x54, 0x72, 0x6B]); dv.setUint32(4, bytes.length);
        return [head, new Uint8Array(bytes)];
    }
    function midiBlob(rec, info) {
        const tick = s => Math.round(s * rec.bpm / 60 * PPQ);
        const vel = v => Math.max(1, Math.min(127, Math.round(v / 0.9 * 100)));
        const tracks = [];
        const us = Math.round(60000000 / rec.bpm);
        tracks.push(midiTrack([
            { t: 0, o: 1, b: [0xFF, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
            { t: 0, o: 1, b: [0xFF, 0x58, 4, 4, 2, 24, 8] }
        ], 'Séquenceur pas à pas'));
        const drums = [];
        rec.events.filter(e => e.k === 'd').forEach(e => {
            const note = GM_DRUM[e.track] || 38, t = tick(e.when);
            drums.push({ t, o: 2, b: [0x99, note, vel(e.vel)] }, { t: t + 60, o: 0, b: [0x89, note, 0] });
        });
        if (drums.length) tracks.push(midiTrack(drums, 'Batterie'));
        const chans = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
        const keys = Object.keys(SeqAudio.TIMBRES).filter(k => rec.events.some(e => e.k === 'n' && e.key === k));
        keys.forEach((k, i) => {
            const ch = chans[i % chans.length], items = [{ t: 0, o: 1, b: [0xC0 | ch, GM_PROG[k] || 0] }];
            rec.events.filter(e => e.k === 'n' && e.key === k).forEach(e => {
                const t = tick(e.when), len = Math.max(10, tick(e.dur)), note = Math.max(0, Math.min(127, e.midi));
                items.push({ t, o: 2, b: [0x90 | ch, note, vel(e.vel)] }, { t: t + len, o: 0, b: [0x80 | ch, note, 0] });
            });
            tracks.push(midiTrack(items, SeqAudio.TIMBRES[k].label));
        });
        const head = new Uint8Array(14), dv = new DataView(head.buffer);
        head.set([0x4D, 0x54, 0x68, 0x64]); dv.setUint32(4, 6); dv.setUint16(8, 1); dv.setUint16(10, tracks.length); dv.setUint16(12, PPQ);
        return new Blob([head].concat(...tracks), { type: 'audio/midi' });
    }

    /* ---------- Actions ---------- */
    function plan() {
        const info = deps.info();
        const n = info.song ? info.songBars : bars;
        const seconds = n * info.div * 60 / info.bpm / (info.div / 4);
        return { info, bars: n, seconds };
    }
    function refreshInfo() {
        const p = plan();
        loopBox.hidden = p.info.song;
        songNote.hidden = !p.info.song;
        songNote.textContent = p.info.song ? 'Mode Chanson : toute la chanson est exportée une fois (' + p.info.songBars + ' mesure' + (p.info.songBars > 1 ? 's' : '') + ').' : '';
        foldChk.parentElement.hidden = p.info.song;
        const bytes = (p.seconds + (p.info.song || !fold ? TAIL : 0)) * SR * 2 * (bits / 8);
        infoEl.textContent = 'Durée : ' + fmtSec(p.seconds) + ' · mix ≈ ' + fmtMo(bytes) + ' · tempo ' + p.info.bpm + ' BPM';
        [barsSeg, bitsSeg].forEach(seg => seg.querySelectorAll('button').forEach(b => {
            const on = seg === barsSeg ? +b.dataset.v === bars : +b.dataset.v === bits;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }));
    }
    function setBusy(on) {
        busy = on;
        [btnMix, btnStems, btnMidi].forEach(b => { b.disabled = on; });
    }
    function baseName() {
        const p = plan();
        return slug('sequenceur-' + p.info.bpm + 'bpm');
    }
    function tooLong(p) {
        if (p.seconds > MAX_SEC) { say('Trop long (' + fmtSec(p.seconds) + ') : l’export est limité à ' + fmtSec(MAX_SEC) + '. Choisissez moins de mesures.', true); return true; }
        return false;
    }

    async function exportMix() {
        const p = plan();
        if (tooLong(p)) return;
        setBusy(true);
        try {
            say('Préparation…');
            await wait(30);
            const rec = deps.record({ bars: p.bars, human: true });
            say('Rendu du mix (chargement des sons, puis calcul)…');
            let r = await render(rec, rec.events, {}, false);
            const loopFrames = Math.round(rec.seconds * SR);
            const keepTail = p.info.song || !fold;
            if (!keepTail) r = foldTail(r.l, r.r, Math.min(loopFrames, r.l.length));
            const w = encodeWav(r.l, r.r, bits, true);
            save(baseName() + '-' + p.bars + (p.bars > 1 ? 'mesures' : 'mesure') + '.wav', new Blob([w.buf], { type: 'audio/wav' }));
            say('Mix exporté (WAV ' + bits + ' bits' + (bits === 32 ? ' flottants' : '') + ', ' + fmtSec(r.l.length / SR) + ')' + (w.scaled ? ' · niveau ramené à −0,2 dB pour éviter la saturation' : '') + '.');
        } catch (e) {
            say('Export impossible : ' + (e && e.message ? e.message : e), true);
        }
        setBusy(false);
    }

    async function exportStems() {
        const p = plan();
        if (tooLong(p)) return;
        setBusy(true);
        try {
            say('Préparation…');
            await wait(30);
            const rec = deps.record({ bars: p.bars, human: true });
            const stems = [];
            deps.info().drums.forEach(d => { if (rec.events.some(e => e.k === 'd' && e.track === d.id)) stems.push({ name: d.name, f: e => e.k === 'd' && e.track === d.id }); });
            Object.keys(SeqAudio.TIMBRES).forEach(k => { if (rec.events.some(e => e.k === 'n' && e.key === k)) stems.push({ name: SeqAudio.TIMBRES[k].label, f: e => e.k === 'n' && e.key === k }); });
            if (!stems.length) { say('Rien à exporter : aucune piste ne joue (pistes coupées, ou motif vide).', true); setBusy(false); return; }
            const shared = {}, files = [], loopFrames = Math.round(rec.seconds * SR), keepTail = p.info.song || !fold;
            let clipped = [];
            for (let i = 0; i < stems.length; i++) {
                say('Piste ' + (i + 1) + ' sur ' + stems.length + ' : ' + stems[i].name + '…');
                await wait(30);
                let r = await render(rec, rec.events.filter(stems[i].f), shared, true);
                if (!keepTail) r = foldTail(r.l, r.r, Math.min(loopFrames, r.l.length));
                const w = encodeWav(r.l, r.r, bits, false);
                if (bits < 32 && w.peak > 0.999) clipped.push(stems[i].name);
                files.push({ name: String(i + 1).padStart(2, '0') + '-' + stems[i].name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.wav', data: w.buf });
            }
            save(baseName() + '-pistes.zip', zipBlob(files));
            say(stems.length + ' pistes exportées dans un .zip (WAV ' + bits + ' bits, toutes de la même longueur, à caler au début dans votre logiciel).'
                + (clipped.length ? ' Attention : ça dépasse 0 dB sur ' + clipped.join(', ') + ' ; choisissez 32 bits flottants pour éviter la saturation.' : ''));
        } catch (e) {
            say('Export impossible : ' + (e && e.message ? e.message : e), true);
        }
        setBusy(false);
    }

    function exportMidi() {
        const p = plan();
        if (tooLong(p)) return;
        setBusy(true);
        try {
            const rec = deps.record({ bars: p.bars, human: false });
            if (!rec.events.length) { say('Rien à exporter : aucune piste ne joue (pistes coupées, ou motif vide).', true); setBusy(false); return; }
            save(baseName() + '-' + p.bars + (p.bars > 1 ? 'mesures' : 'mesure') + '.mid', midiBlob(rec, p.info));
            say('Fichier MIDI exporté : batterie sur le canal 10, un canal par instrument de la mélodie. Le swing y est inscrit ; l’humanisation, non.');
        } catch (e) {
            say('Export impossible : ' + (e && e.message ? e.message : e), true);
        }
        setBusy(false);
    }

    /* ---------- Fenêtre ---------- */
    function seg(label, values, fmt, get, set) {
        const s = h('div', 'seg');
        s.setAttribute('role', 'group');
        s.setAttribute('aria-label', label);
        values.forEach(v => {
            const b = btn(fmt(v), '', () => { set(v); refreshInfo(); });
            b.dataset.v = v;
            s.append(b);
        });
        return s;
    }
    function build() {
        root = h('div', 'proj-back');
        root.hidden = true;
        const box = h('section', 'proj');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'expTitle');

        const head = h('div', 'insp-head');
        const title = h('strong', null, 'Exporter');
        title.id = 'expTitle';
        const x = h('button', 'insp-x', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', 'Fermer');
        x.addEventListener('click', () => close());
        head.append(title, x);

        const dur = h('div', 'fx');
        dur.append(h('span', 'lbl', 'Durée'));
        loopBox = h('div', 'fx');
        barsSeg = seg('Nombre de mesures', [1, 2, 4, 8, 16], v => v + (v > 1 ? ' mesures' : ' mesure'), null, v => { bars = v; });
        loopBox.append(barsSeg);
        songNote = h('p', 'hint');
        const foldLab = h('label', 'chk');
        foldChk = h('input');
        foldChk.type = 'checkbox';
        foldChk.checked = fold;
        foldChk.addEventListener('change', () => { fold = foldChk.checked; refreshInfo(); });
        foldLab.append(foldChk, document.createTextNode(' Boucle parfaite : la fin des sons (échos, réverbération) revient au début'));
        infoEl = h('p', 'hint');
        dur.append(loopBox, songNote, foldLab, infoEl);

        const audio = h('div', 'fx');
        audio.append(h('span', 'lbl', 'Audio (WAV)'));
        bitsSeg = seg('Format', [16, 24, 32], v => v === 32 ? '32 bits flottants' : v + ' bits', null, v => { bits = v; });
        btnMix = btn('Exporter le mix', 'btn-sm btn-gen', exportMix, 'Un fichier WAV, avec le compresseur général de l’appli');
        btnStems = btn('Une piste par fichier (.zip)', 'btn-sm', exportStems, 'Un WAV par piste de batterie et par instrument de la mélodie, pour les mixer dans votre logiciel (sans le compresseur général)');
        const row = h('div', 'proj-files');
        row.append(btnMix, btnStems);
        audio.append(bitsSeg, row, h('p', 'hint', 'Le rendu tient compte des coupures (M), des solos (S), des volumes, des sons édités et de l’humanisation. Un coup tiré au sort par une probabilité est tiré une fois pour toutes dans l’export.'));

        const midi = h('div', 'fx');
        midi.append(h('span', 'lbl', 'MIDI'));
        btnMidi = btn('Exporter en MIDI (.mid)', 'btn-sm', exportMidi, 'Batterie sur le canal 10, un canal par instrument de la mélodie');
        midi.append(btnMidi);

        msgEl = h('p', 'proj-msg');
        msgEl.setAttribute('role', 'status');

        box.append(head, dur, audio, midi, msgEl);
        root.append(box);
        root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
        root.addEventListener('keydown', e => {
            e.stopPropagation();                      // la barre d'espace ne lance pas la lecture ici
            if (e.key === 'Escape') close();
        });
        document.body.append(root);
    }

    function open() {
        if (!root) build();
        opener = document.activeElement;
        say('');
        refreshInfo();
        root.hidden = false;
        document.body.classList.add('proj-open');
        root.querySelector('.insp-x').focus();
    }
    function close() {
        if (!root || root.hidden) return;
        root.hidden = true;
        document.body.classList.remove('proj-open');
        if (opener && opener.focus) opener.focus();
        opener = null;
    }
    const isOpen = () => !!root && !root.hidden;
    function init(d) { deps = d; }

    // (les fonctions commençant par _ servent aux tests : « node app/export.test.js »)
    return { init, open, close, isOpen, _midiBlob: midiBlob, _encodeWav: encodeWav, _zipBlob: zipBlob, _crc32: crc32, _foldTail: foldTail };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Exporter;
