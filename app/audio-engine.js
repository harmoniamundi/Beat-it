// audio-engine.js — son du Séquenceur pas à pas.
//  - Percussions : les synthés de la batterie de Chord Scales (audio/drum-synths.js), jouées avec leur « runtime » audio.
//  - Mélodie : chaque note peut avoir son instrument. Piano, trompette et basse sont des échantillons (soundfont-player,
//    lus depuis app/sounds/, voir audio/local-soundfonts.js) ; les autres sont synthétisés (audio/synth-voices.js).
//    Le synthé joue aussi de secours tant qu'un échantillon charge ou si son fichier est introuvable.
// Chargé après soundfont-player, local-soundfonts.js, drum-synths.js et synth-voices.js. Aucun accès au DOM.

const SeqAudio = (() => {
    // Instruments de la mélodie, dans l'ordre où on les propose.
    //   label : nom affiché · color : couleur des cases · shift : décalage d'octaves proposé au départ
    //   sf / bank : échantillon (soundfont-player) ; sans `sf`, l'instrument est synthétisé (voix du même nom dans synth-voices.js)
    const TIMBRES = {
        piano:     { label: 'Piano',          color: '#e2e8f0', shift: 0,  sf: 'acoustic_grand_piano', bank: 'FluidR3_GM' },
        organ:     { label: 'Orgue',          color: '#f97316', shift: 0 },
        guitar:    { label: 'Guitare',        color: '#b8794b', shift: 0 },
        strings:   { label: 'Cordes',         color: '#f43f5e', shift: 0 },
        bass:      { label: 'Basse',          color: '#3b82f6', shift: -2, sf: 'electric_bass_finger', bank: 'FluidR3_GM' },
        synthbass: { label: 'Basse synthé',   color: '#f472b6', shift: -2 },
        trumpet:   { label: 'Trompette',      color: '#fbbf24', shift: 0,  sf: 'trumpet', bank: 'MusyngKite' },
        flute:     { label: 'Flûte',          color: '#2dd4bf', shift: 0 },
        clarinet:  { label: 'Clarinette',     color: '#a3e635', shift: 0 },
        marimba:   { label: 'Marimba',        color: '#22c55e', shift: 0 },
        vibes:     { label: 'Vibraphone',     color: '#818cf8', shift: 0 },
        bells:     { label: 'Carillon',       color: '#38bdf8', shift: 0 },
        synth:     { label: 'Synthé',         color: '#a855f7', shift: 0 },
        chip:      { label: 'Chiptune',       color: '#e879f9', shift: 0 },
        pad:       { label: 'Nappe',          color: '#94a3b8', shift: 0 }
    };

    let ctx = null, master, comp, drumBus, melBus, reverbIn, noiseBuf, satCurve, rt;
    const trackGain = {}, nodes = [], players = {};
    const vols = { track: {}, drum: 0.8, mel: 0.7 };
    let lastOpen = null, timbre = 'piano', voices = {}, statusFn = () => {};
    const wanted = new Set(['piano']);       // instruments à échantillons dont la page a besoin (chargés dès que le son démarre)

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
            voices = createSynthVoices({ ctx, nodes, noise: () => noiseBuf });
            wanted.add(timbre);
            wanted.forEach(loadTimbre);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return true;
    }

    const now = () => (ctx ? ctx.currentTime : 0);
    const get = () => ctx;

    /* ---------- Verrous de paramètres (filtre, panoramique, réverbération d'un seul pas) ---------- */
    // fx : { flt (0–100, 100 = ouvert), pan (−100…100), rev (0–100) }. Renvoie le nœud où brancher le son du pas :
    // lui-même est relié à `dest` à travers un filtre passe-bas, un panoramique et un envoi de réverbération.
    function fxInput(dest, fx) {
        const inp = ctx.createGain();
        let last = inp;
        if (fx.flt < 100) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass'; lp.Q.value = 0.8;
            lp.frequency.value = 200 * Math.pow(100, fx.flt / 100);     // 200 Hz → 20 kHz
            last.connect(lp); last = lp;
        }
        if (fx.pan && ctx.createStereoPanner) {
            const pn = ctx.createStereoPanner();
            pn.pan.value = Math.max(-1, Math.min(1, fx.pan / 100));
            last.connect(pn); last = pn;
        }
        last.connect(dest);
        if (fx.rev > 0) {
            const send = ctx.createGain();
            send.gain.value = (fx.rev / 100) * 1.6;
            last.connect(send); send.connect(reverbIn);
        }
        return inp;
    }

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
        if (nodes.length > 1500) nodes.splice(0, nodes.length - 700);
    }

    // trackId : piste de la grille ; drum : nom du coup dans drum-synths.js (kick, snare, rim, hat, ohat, ride, bell, tom2, clave…)
    // vel : force du coup (0,9 par défaut) ; fx : verrous du pas (voir fxInput), ou rien
    function playDrum(trackId, drum, when, vel, fx) {
        if (!ctx) return;
        const v = vel == null ? 0.9 : vel;
        let dest = trackNode(trackId);
        if (fx) dest = fxInput(dest, fx);
        if (drum === 'hat' || drum === 'ohat') chokeOpen(when);
        if (drum === 'ohat') {
            const g = ctx.createGain();
            g.connect(dest);
            synthDrumLive(rt, { drum }, when, g, v);
            lastOpen = g;
        } else {
            synthDrumLive(rt, { drum }, when, dest, v);
        }
        prune();
    }

    /* ---------- Mélodie ---------- */
    // Pastille d'état : ce qui charge encore, ou ce qui manque (le synthé joue alors à la place).
    function refreshStatus() {
        const names = (state) => Object.keys(players).filter((k) => wanted.has(k) && players[k].state === state).map((k) => TIMBRES[k].label);
        const loading = names('loading'), failed = names('failed');
        if (loading.length) statusFn('Chargement : ' + loading.join(', ') + '…');
        else if (failed.length) statusFn('Son introuvable (' + failed.join(', ') + ') : synthé de secours');
        else statusFn('');
    }

    function loadTimbre(key) {
        const def = TIMBRES[key];
        if (!def || !def.sf || !ctx) return Promise.resolve();
        const p = players[key] || (players[key] = { state: 'idle' });
        if (p.state === 'loading' || p.state === 'ready' || p.state === 'failed') return p.promise || Promise.resolve();
        if (typeof Soundfont === 'undefined') { p.state = 'failed'; refreshStatus(); return Promise.resolve(); }
        p.state = 'loading';
        refreshStatus();
        p.promise = Soundfont.instrument(ctx, def.sf, { soundfont: def.bank, format: 'mp3', destination: melBus })
            .then((inst) => { p.inst = inst; p.state = 'ready'; refreshStatus(); })
            .catch(() => { p.state = 'failed'; refreshStatus(); });
        return p.promise;
    }

    // Annonce les instruments utilisés par la mélodie : ceux qui sont à échantillons sont chargés (tout de suite si le
    // son est déjà démarré, sinon au démarrage).
    function want(keys) {
        keys.forEach((k) => { if (TIMBRES[k]) { wanted.add(k); if (ctx) loadTimbre(k); } });
    }

    // Instrument « par défaut » (celui qu'on entend en écoutant une note, ou quand une note n'en précise pas).
    function setTimbre(key) {
        if (!TIMBRES[key]) return;
        timbre = key;
        want([key]);
        refreshStatus();
    }

    // fx : verrous du pas (voir fxInput), ou rien · key : instrument de la note (sinon l'instrument par défaut)
    function playNote(midi, when, dur, vel, fx, key) {
        if (!ctx) return;
        const k = TIMBRES[key] ? key : timbre, def = TIMBRES[k];
        const out = fx ? fxInput(melBus, fx) : melBus;
        if (def.sf) {
            const p = players[k];
            if (p && p.state === 'ready') {
                try { p.inst.play(Theory.midiName(midi), when, { duration: dur, gain: vel, destination: out }); prune(); return; }
                catch (e) { /* on retombe sur le synthé */ }
            } else if (!p || p.state === 'idle') {
                want([k]);
            }
            voices.synth(midi, when, dur, vel, out);                 // en attendant l'échantillon (ou s'il manque)
        } else {
            (voices[k] || voices.synth)(midi, when, dur, vel, out);
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
        TIMBRES, init, now, get, playDrum, playNote, setTimbre, want, setTrackVolume, setDrumVolume, setMelodyVolume, stopAll,
        onStatus(fn) { statusFn = fn || (() => {}); }
    };
})();
