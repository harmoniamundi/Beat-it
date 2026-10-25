// audio-engine.js — son du Séquenceur pas à pas.
//  - Percussions : les synthés de la batterie de Chord Scales (audio/drum-synths.js), jouées avec leur « runtime » audio.
//  - Mélodie : échantillons d'instruments (piano, trompette, basse) via soundfont-player, lus depuis le dossier
//    app/sounds/ (voir audio/local-soundfonts.js) ; un petit synthé de secours joue tant que l'instrument charge
//    ou si son fichier est introuvable.
// Chargé après soundfont-player, local-soundfonts.js et drum-synths.js. Aucun accès au DOM.

const SeqAudio = (() => {
    // Timbres de la mélodie. `oct` : octave de départ proposée quand on choisit ce timbre.
    const TIMBRES = {
        piano:   { label: 'Piano',     sf: 'acoustic_grand_piano', bank: 'FluidR3_GM', oct: 4 },
        trumpet: { label: 'Trompette', sf: 'trumpet',              bank: 'MusyngKite', oct: 4 },
        bass:    { label: 'Basse',     sf: 'electric_bass_finger', bank: 'FluidR3_GM', oct: 2 },
        synth:   { label: 'Synthé',    sf: null,                   bank: null,         oct: 4 }
    };

    let ctx = null, master, comp, drumBus, melBus, reverbIn, noiseBuf, satCurve, rt;
    const trackGain = {}, nodes = [], players = {};
    const vols = { track: {}, drum: 0.8, mel: 0.7 };
    let lastOpen = null, timbre = 'piano', statusFn = () => {};

    function buildReverb() {
        // Petite réverbération (bruit à décroissance exponentielle) : sert aux cymbales et, très peu, à la mélodie.
        const len = Math.floor(ctx.sampleRate * 1.4);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        const conv = ctx.createConvolver();
        conv.buffer = ir;
        reverbIn = ctx.createGain();
        const wet = ctx.createGain();
        wet.gain.value = 0.28;
        reverbIn.connect(conv); conv.connect(wet); wet.connect(master);
        const melSend = ctx.createGain();
        melSend.gain.value = 0.16;
        melBus.connect(melSend); melSend.connect(reverbIn);
    }

    function init() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            ctx = new AC();
            comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
            master = ctx.createGain();
            master.gain.value = 0.9;
            master.connect(comp); comp.connect(ctx.destination);
            drumBus = ctx.createGain(); drumBus.gain.value = vols.drum; drumBus.connect(master);
            melBus = ctx.createGain(); melBus.gain.value = vols.mel; melBus.connect(master);
            noiseBuf = makeNoiseBuffer(ctx);
            satCurve = makeSaturationCurve();
            buildReverb();
            const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
            rt = { ctx, tier: cores <= 2 ? 1 : 0, nodes, noise: () => noiseBuf, curve: () => satCurve, reverb: () => reverbIn };
            loadTimbre(timbre);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return true;
    }

    const now = () => (ctx ? ctx.currentTime : 0);
    const get = () => ctx;

    /* ---------- Percussions ---------- */
    function trackNode(id) {
        if (!trackGain[id]) {
            const g = ctx.createGain();
            g.gain.value = vols.track[id] != null ? vols.track[id] : 0.8;
            g.connect(drumBus);
            trackGain[id] = g;
        }
        return trackGain[id];
    }

    // Un charleston fermé coupe le charleston ouvert qui sonne encore.
    function chokeOpen(t) {
        if (!lastOpen) return;
        const g = lastOpen.gain;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(0.0001, t, 0.012);
        lastOpen = null;
    }

    function prune() {
        if (nodes.length > 500) nodes.splice(0, nodes.length - 250);
    }

    // trackId : piste de la grille ; drum : nom du coup dans drum-synths.js (kick, snare, rim, hat, ohat, ride, bell, tom2, clave…)
    function playDrum(trackId, drum, when) {
        if (!ctx) return;
        const dest = trackNode(trackId);
        if (drum === 'hat' || drum === 'ohat') chokeOpen(when);
        if (drum === 'ohat') {
            const g = ctx.createGain();
            g.connect(dest);
            synthDrumLive(rt, { drum }, when, g, 0.9);
            lastOpen = g;
        } else {
            synthDrumLive(rt, { drum }, when, dest, 0.9);
        }
        prune();
    }

    /* ---------- Mélodie ---------- */
    function loadTimbre(key) {
        const def = TIMBRES[key];
        if (!def || !def.sf || !ctx) return Promise.resolve();
        const p = players[key] || (players[key] = { state: 'idle' });
        if (p.state === 'loading' || p.state === 'ready' || p.state === 'failed') return p.promise || Promise.resolve();
        if (typeof Soundfont === 'undefined') { p.state = 'failed'; return Promise.resolve(); }
        p.state = 'loading';
        if (key === timbre) statusFn('Chargement : ' + def.label + '…');
        p.promise = Soundfont.instrument(ctx, def.sf, { soundfont: def.bank, format: 'mp3', destination: melBus })
            .then((inst) => {
                p.inst = inst;
                p.state = 'ready';
                if (key === timbre) statusFn('');
            })
            .catch(() => {
                p.state = 'failed';
                if (key === timbre) statusFn('Son de ' + def.label.toLowerCase() + ' introuvable : synthé de secours');
            });
        return p.promise;
    }

    function setTimbre(key) {
        if (!TIMBRES[key]) return;
        timbre = key;
        statusFn('');
        if (ctx) loadTimbre(key);
    }

    // Synthé de secours : deux oscillateurs filtrés, enveloppe simple.
    function synthNote(midi, when, dur, vel) {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        const lp = ctx.createBiquadFilter(), g = ctx.createGain();
        const hold = Math.max(dur, 0.04);
        o1.type = 'triangle'; o2.type = 'sawtooth';
        o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = 6;
        lp.type = 'lowpass'; lp.Q.value = 0.7;
        lp.frequency.setValueAtTime(Math.min(f * 7, 9000), when);
        lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 500), when + hold);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(0.2 * vel, when + 0.01);
        g.gain.setValueAtTime(0.2 * vel, when + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, when + hold + 0.15);
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(melBus);
        o1.start(when); o2.start(when);
        o1.stop(when + hold + 0.2); o2.stop(when + hold + 0.2);
        nodes.push(o1, o2);
    }

    function playNote(midi, when, dur, vel) {
        if (!ctx) return;
        const p = players[timbre];
        if (TIMBRES[timbre].sf && p && p.state === 'ready') {
            try { p.inst.play(Theory.midiName(midi), when, { duration: dur, gain: vel }); } catch (e) { synthNote(midi, when, dur, vel); }
        } else {
            synthNote(midi, when, dur, vel);
        }
        prune();
    }

    /* ---------- Volumes, arrêt ---------- */
    function setTrackVolume(id, v) {
        vols.track[id] = v;
        if (trackGain[id]) trackGain[id].gain.setTargetAtTime(v, ctx.currentTime, 0.01);
    }
    function setDrumVolume(v) {
        vols.drum = v;
        if (drumBus) drumBus.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
    }
    function setMelodyVolume(v) {
        vols.mel = v;
        if (melBus) melBus.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
    }

    function stopAll() {
        nodes.splice(0).forEach((n) => { try { n.stop(); } catch (e) { /* déjà arrêté */ } });
        Object.keys(players).forEach((k) => {
            const p = players[k];
            if (p.inst && typeof p.inst.stop === 'function') { try { p.inst.stop(); } catch (e) { /* ignoré */ } }
        });
        lastOpen = null;
    }

    return {
        TIMBRES, init, now, get, playDrum, playNote, setTimbre, setTrackVolume, setDrumVolume, setMelodyVolume, stopAll,
        onStatus(fn) { statusFn = fn || (() => {}); }
    };
})();
