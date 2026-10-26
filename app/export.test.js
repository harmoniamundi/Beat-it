// export.test.js — vérifie les fichiers de l'export (WAV, ZIP, MIDI) : « node app/export.test.js »
const assert = require('assert');
global.SeqAudio = { TIMBRES: { piano: { label: 'Piano' }, bass: { label: 'Basse' } } };
const Exporter = require('./export.js');

(async () => {
    // CRC-32 : valeur de référence
    assert.strictEqual(Exporter._crc32(new TextEncoder().encode('123456789')), 0xCBF43926);

    // WAV 16 bits : en-tête, taille, niveaux, limitation au-dessus de 0 dB
    const l = new Float32Array([0, 0.5, -0.5, 1.5]), r = new Float32Array([0, -0.25, 0.25, 0]);
    let w = Exporter._encodeWav(l, r, 16, true), v = new DataView(w.buf);
    assert.strictEqual(w.buf.byteLength, 44 + 4 * 2 * 2);
    assert.strictEqual(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
    assert.strictEqual(v.getUint16(20, true), 1);
    assert.strictEqual(v.getUint16(22, true), 2);
    assert.strictEqual(v.getUint32(24, true), 44100);
    assert.strictEqual(v.getUint16(34, true), 16);
    assert.strictEqual(v.getUint32(40, true), 16);
    assert.ok(w.scaled && Math.abs(w.peak - 1.5) < 1e-6, 'un son au-dessus de 0 dB est ramené en dessous');
    assert.ok(Math.abs(v.getInt16(44 + 3 * 4, true)) <= 32767 * 0.99, 'le crête est sous 0 dB');
    // sans limitation (pistes séparées) : pas de changement de niveau, saturation seulement au-delà du possible
    w = Exporter._encodeWav(new Float32Array([0.5, -0.5]), new Float32Array([0.25, 0]), 16, false); v = new DataView(w.buf);
    assert.ok(!w.scaled);
    assert.strictEqual(v.getInt16(44, true), Math.round(0.5 * 32767));        // image 1 : gauche
    assert.strictEqual(v.getInt16(46, true), Math.round(0.25 * 32767));       // image 1 : droite
    assert.strictEqual(v.getInt16(48, true), -16384);                          // image 2 : gauche
    assert.strictEqual(v.getInt16(50, true), 0);
    // 24 bits : 3 octets par échantillon, valeur signée
    w = Exporter._encodeWav(new Float32Array([0.5, -0.5]), new Float32Array([0, 0]), 24, false); v = new DataView(w.buf);
    assert.strictEqual(w.buf.byteLength, 44 + 2 * 2 * 3);
    const s24 = o => { let x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); return x & 0x800000 ? x - 0x1000000 : x; };
    assert.strictEqual(s24(44), Math.round(0.5 * 8388607));
    assert.strictEqual(s24(44 + 6), Math.round(-0.5 * 8388608));
    // 32 bits flottants : format 3, valeurs exactes, jamais limitées
    w = Exporter._encodeWav(new Float32Array([1.5]), new Float32Array([-2]), 32, true); v = new DataView(w.buf);
    assert.strictEqual(v.getUint16(20, true), 3);
    assert.strictEqual(v.getFloat32(44, true), 1.5);
    assert.strictEqual(v.getFloat32(48, true), -2);

    // Boucle parfaite : la queue revient au début, y compris quand elle est plus longue que la boucle
    const fl = new Float32Array([1, 0, 0, 0, 0.5, 0.25, 0.125, 0.0625, 2]);
    const f = Exporter._foldTail(fl.slice(), fl.slice(), 4);
    assert.strictEqual(f.l.length, 4);
    assert.deepStrictEqual(Array.from(f.l), [1 + 0.5 + 2, 0.25, 0.125, 0.0625]);

    // ZIP : lecture du répertoire central, noms UTF-8, tailles, CRC
    const A = new TextEncoder().encode('Bonjour'), B = new TextEncoder().encode('123456789');
    const zip = Buffer.from(await Exporter._zipBlob([{ name: '01-Charley fermé.wav', data: A.buffer }, { name: '02-Piano.wav', data: B.buffer }]).arrayBuffer());
    const end = zip.length - 22;
    assert.strictEqual(zip.readUInt32LE(end), 0x06054b50);
    assert.strictEqual(zip.readUInt16LE(end + 10), 2);
    let pos = zip.readUInt32LE(end + 16);
    const names = [];
    for (let i = 0; i < 2; i++) {
        assert.strictEqual(zip.readUInt32LE(pos), 0x02014b50);
        const crc = zip.readUInt32LE(pos + 16), size = zip.readUInt32LE(pos + 24), nl = zip.readUInt16LE(pos + 28), off = zip.readUInt32LE(pos + 42);
        names.push(zip.slice(pos + 46, pos + 46 + nl).toString('utf8'));
        assert.strictEqual(zip.readUInt32LE(off), 0x04034b50);
        const lnl = zip.readUInt16LE(off + 26), data = zip.slice(off + 30 + lnl, off + 30 + lnl + size);
        assert.strictEqual(Exporter._crc32(new Uint8Array(data)), crc);
        assert.strictEqual(data.toString('utf8'), i ? '123456789' : 'Bonjour');
        pos += 46 + nl;
    }
    assert.deepStrictEqual(names, ['01-Charley fermé.wav', '02-Piano.wav']);

    // MIDI : en-tête, tempo, batterie sur le canal 10, un canal par instrument, force 100 = normal, durées
    const rec = {
        bpm: 120, seconds: 2, bars: 1,
        events: [
            { k: 'd', track: 'kick', drum: 'kick', when: 0, vel: 0.9 },
            { k: 'd', track: 'snare', drum: 'snare', when: 0.5, vel: 0.9 * 1.15 },
            { k: 'd', track: 'hat', drum: 'hat', when: 0.75, vel: 0.9 * 0.42 },
            { k: 'n', midi: 60, when: 0, dur: 0.5, vel: 0.9, key: 'piano' },
            { k: 'n', midi: 36, when: 0.5, dur: 0.25, vel: 0.9, key: 'bass' }
        ]
    };
    const mid = Buffer.from(await Exporter._midiBlob(rec, {}).arrayBuffer());
    assert.strictEqual(mid.slice(0, 4).toString(), 'MThd');
    assert.strictEqual(mid.readUInt16BE(8), 1);
    assert.strictEqual(mid.readUInt16BE(10), 4);          // tempo, batterie, piano, basse
    assert.strictEqual(mid.readUInt16BE(12), 480);
    let p = 14; const tracks = [];
    while (p < mid.length) {
        assert.strictEqual(mid.slice(p, p + 4).toString(), 'MTrk');
        const ln = mid.readUInt32BE(p + 4), body = mid.slice(p + 8, p + 8 + ln);
        p += 8 + ln;
        let i = 0, t = 0, run = 0; const evs = [];
        while (i < body.length) {
            let d = 0, b;
            do { b = body[i++]; d = (d << 7) | (b & 127); } while (b & 128);
            t += d;
            if (body[i] === 0xFF) { const ty = body[i + 1], l2 = body[i + 2]; evs.push({ t, meta: ty, data: body.slice(i + 3, i + 3 + l2) }); i += 3 + l2; continue; }
            if (body[i] & 0x80) run = body[i++];
            const hi = run & 0xF0;
            if (hi === 0xC0) { evs.push({ t, pc: body[i], ch: run & 15 }); i += 1; }
            else { evs.push({ t, on: hi === 0x90, off: hi === 0x80, ch: run & 15, n: body[i], v: body[i + 1] }); i += 2; }
        }
        tracks.push(evs);
    }
    const tempo = tracks[0].find(e => e.meta === 0x51).data;
    assert.strictEqual((tempo[0] << 16) | (tempo[1] << 8) | tempo[2], 500000);        // 120 BPM
    const drums = tracks[1].filter(e => e.on);
    assert.deepStrictEqual(drums.map(e => [e.t, e.ch, e.n, e.v]), [[0, 9, 36, 100], [480, 9, 38, 115], [720, 9, 42, 42]]);   // 0,5 s = 1 noire = 480 ticks
    const piano = tracks[2];
    assert.deepStrictEqual(piano.filter(e => e.pc !== undefined).map(e => [e.ch, e.pc]), [[0, 0]]);
    assert.deepStrictEqual(piano.filter(e => e.on || e.off).map(e => [e.t, e.on ? 'on' : 'off', e.n]), [[0, 'on', 60], [480, 'off', 60]]);
    assert.strictEqual(tracks[3].find(e => e.on).ch, 1);
    assert.strictEqual(tracks[3].find(e => e.pc !== undefined).pc, 33);

    console.log('OK : export.test.js');
})().catch(e => { console.error(e); process.exit(1); });
