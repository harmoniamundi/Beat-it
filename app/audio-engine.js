// audio-engine.js — son du Séquenceur pas à pas.
//  - Percussions : les synthés de la batterie de Chord Scales (audio/drum-synths.js), jouées avec leur « runtime » audio.
//  - Mélodie : chaque note peut avoir son instrument. Piano, trompette et basse sont des échantillons (soundfont-player,
//    lus depuis app/sounds/, voir audio/local-soundfonts.js) ; les autres sont synthétisés (audio/synth-voices.js).
//    Le synthé joue aussi de secours tant qu'un échantillon charge ou si son fichier est introuvable.
// Les 12 instruments synthétisés sont des patchs FM à 6 opérateurs (audio/fm-synth.js) calculés note par note puis rejoués
// comme de petits échantillons. Chaque instrument a sa chaîne de sortie réglable : saturation, filtre, delay, panoramique, volume.
// Chargé après soundfont-player, local-soundfonts.js, drum-synths.js, synth-voices.js et fm-synth.js. Aucun accès au DOM.

const SeqAudio = (() => {
    // Instruments de la mélodie, dans l'ordre où on les propose.
    //   label : nom affiché · color : couleur des cases · shift : décalage d'octaves proposé au départ
    //   sf / bank : échantillon (soundfont-player) ; sans `sf`, l'instrument est un patch FM (FMSynth.FACTORY, fm-synth.js)
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

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    let ctx = null, master, comp, drumBus, melBus, reverbIn, noiseBuf, satCurve, rt;
    const trackGain = {}, nodes = [], players = {}, ins = {}, insOn = {};
    const sounds = {}, rev = {};                      // son (patch FM ou enveloppe, réglages de sortie) et numéro de version de chaque instrument
    const fmCache = new Map();                        // notes FM déjà calculées : clé → tampon (le plus ancien en tête)
    let fmCacheSize = 0;
    const FM_CACHE_MAX = 9e6;                         // échantillons gardés en mémoire (≈ 36 Mo)
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
            if (typeof Keepalive !== 'undefined') Keepalive.setupAudioSession(); // iPhone : jouer même en mode silencieux
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
        if (ctx.state !== 'running') ctx.resume().catch(() => {}); // 'suspended' ou 'interrupted' (iOS)
        if (typeof Keepalive !== 'undefined') Keepalive.startSilentAudio();
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
    // Chaque instrument passe par sa propre chaîne avant la mélodie :
    //   entrée (couper / isoler : M et S coupent aussi les notes déjà parties, comme une nappe tenue)
    //   → saturation → filtre passe-bas → panoramique → volume → mélodie, plus un delay (filtre → delay → panoramique).
    function insChain(k) {
        let c = ins[k];
        if (c) return c;
        c = ins[k] = {};
        c.inp = ctx.createGain();
        c.inp.gain.value = insOn[k] === false ? 0 : 1;
        c.pre = ctx.createGain(); c.pre.gain.value = 4;
        c.shaper = ctx.createWaveShaper();
        c.post = ctx.createGain(); c.post.gain.value = 0.25;
        c.lp = ctx.createBiquadFilter(); c.lp.type = 'lowpass';
        c.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        c.vol = ctx.createGain();
        c.dly = ctx.createDelay(1.5);
        c.fb = ctx.createGain();
        c.wet = ctx.createGain();
        const tail = c.pan || c.vol;
        c.inp.connect(c.pre); c.pre.connect(c.shaper); c.shaper.connect(c.post); c.post.connect(c.lp);
        c.lp.connect(tail);
        c.lp.connect(c.dly); c.dly.connect(c.wet); c.wet.connect(tail);
        c.dly.connect(c.fb); c.fb.connect(c.dly);
        if (c.pan) c.pan.connect(c.vol);
        c.vol.connect(melBus);
        applyOut(k, true);
        return c;
    }
    const insNode = (k) => insChain(k).inp;
    function setInstrumentAudible(k, on) {
        insOn[k] = !!on;
        if (ins[k]) ins[k].inp.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.01);
    }

    // Courbe de saturation : tanh dont la raideur croît avec le réglage (0 = aucune)
    function driveCurve(d) {
        if (!d) return null;
        const g = 1 + d * 0.12, n = 1024, cv = new Float32Array(n), norm = Math.tanh(g);
        for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(g * x) / norm; }
        return cv;
    }
    // Réglages de sortie d'un instrument (page « param » de l'éditeur) : cut 0–127, res 0–99, drv 0–99,
    // dtime / dfb / dmix 0–99, tune −99…99 (centièmes de ton), pan 0–127 (64 = centre), vol 0–127
    function applyOut(k, now) {
        const c = ins[k], o = (sounds[k] && sounds[k].out) || FMSynth.initOut();
        if (!c) return;
        const t = ctx.currentTime, tc = now ? 0 : 0.015;
        const set = (param, v) => { if (now) param.value = v; else param.setTargetAtTime(v, t, tc); };
        if (c.driveSet !== o.drv) { c.shaper.curve = driveCurve(o.drv); c.driveSet = o.drv; }
        set(c.post.gain, 0.25 / (1 + o.drv / 99 * 1.5));                 // la saturation gonfle le niveau : on le compense
        set(c.lp.frequency, o.cut >= 127 ? 20000 : 30 * Math.pow(20000 / 30, o.cut / 127));
        set(c.lp.Q, o.res / 99 * 18);
        set(c.dly.delayTime, 0.02 + 0.88 * Math.pow(o.dtime / 99, 1.5));
        set(c.fb.gain, o.dfb / 99 * 0.92);
        set(c.wet.gain, o.dmix / 99);
        if (c.pan) set(c.pan.pan, clamp((o.pan - 64) / 64, -1, 1));
        set(c.vol.gain, Math.pow(o.vol / 127, 2));
    }

    // Son d'un instrument : { fm : patch, out : réglages de sortie } ou { env : [attaque, descente, maintien, relâchement], out }
    function setSound(k, s) {
        if (!TIMBRES[k] || !s) return;
        sounds[k] = s;
        rev[k] = (rev[k] || 0) + 1;
        for (const key of Array.from(fmCache.keys())) {
            if (key.indexOf(k + '|') === 0) { fmCacheSize -= fmCache.get(key).length; fmCache.delete(key); }
        }
        if (ctx) applyOut(k, false);
    }

    // Note FM : calculée une fois par (instrument, version du patch, hauteur, durée, force), puis gardée.
    function fmBuffer(k, midi, dur, vel) {
        const patch = sounds[k] && sounds[k].fm;
        if (!patch) return null;
        const sens = patch.ops.some((o) => o.on && o.kvs > 0);
        const v = sens ? Math.round(clamp(vel / 0.9, 0.05, 1) * 8) / 8 : 1;
        const d = Math.round(clamp(dur, 0.02, 10) * 100) / 100;
        const key = k + '|' + rev[k] + '|' + midi + '|' + d + '|' + v + '|' + ctx.sampleRate;
        let buf = fmCache.get(key);
        if (buf) { fmCache.delete(key); fmCache.set(key, buf); return buf; }
        const data = FMSynth.render(patch, midi, d, v, ctx.sampleRate);
        buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        if (buf.copyToChannel) buf.copyToChannel(data, 0); else buf.getChannelData(0).set(data);
        fmCache.set(key, buf);
        fmCacheSize += buf.length;
        for (const old of fmCache.keys()) {            // on rend de la place en retirant les plus anciennes
            if (fmCacheSize <= FM_CACHE_MAX) break;
            fmCacheSize -= fmCache.get(old).length; fmCache.delete(old);
        }
        return buf;
    }

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
    // vel : force de la note (0,9 = normale) · trim : niveau de l'instrument dans le mélange (1 = d'origine)
    function playNote(midi, when, dur, vel, fx, key, trim) {
        if (!ctx) return;
        const k = TIMBRES[key] ? key : timbre, def = TIMBRES[k];
        const bus = insNode(k), out = fx ? fxInput(bus, fx) : bus;
        const tr = trim == null ? 1 : trim, snd = sounds[k] || {}, tune = (snd.out && snd.out.tune) || 0;
        if (def.sf) {
            const p = players[k];
            if (p && p.state === 'ready') {
                const o = { duration: dur, gain: vel * tr, destination: out };
                if (tune) o.cents = tune;
                if (snd.env && (snd.env[0] || snd.env[1] || snd.env[2] < 1 || snd.env[3])) o.adsr = snd.env;
                try { p.inst.play(Theory.midiName(midi), when, o); prune(); return; }
                catch (e) { /* on retombe sur le synthé */ }
            } else if (!p || p.state === 'idle') {
                want([k]);
            }
            voices.synth(midi, when, dur, vel * tr, out);            // en attendant l'échantillon (ou s'il manque)
        } else {
            let buf = null;
            try { buf = fmBuffer(k, midi, dur, vel); } catch (e) { buf = null; }
            if (buf) {
                const src = ctx.createBufferSource(), g = ctx.createGain();
                src.buffer = buf;
                if (tune) src.detune.value = tune;
                g.gain.value = vel * tr;
                src.connect(g); g.connect(out);
                src.start(when);
                nodes.push(src);
            } else {
                voices.synth(midi, when, dur, vel * tr, out);
            }
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
        TIMBRES, init, now, get, playDrum, playNote, setTimbre, want, setInstrumentAudible, setSound, setTrackVolume, setDrumVolume, setMelodyVolume, stopAll,
        onStatus(fn) { statusFn = fn || (() => {}); }
    };
})();
