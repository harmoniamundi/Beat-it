// audio-engine.js — son du Séquenceur pas à pas.
//  - Percussions : les synthés de la batterie de Chord Scales (audio/drum-synths.js), jouées avec leur « runtime » audio.
//  - Mélodie : chaque note peut avoir son instrument, et chaque instrument plusieurs sons possibles (audio/sound-lib.js) :
//      · échantillons soundfont-player (piano, basse, trompette ; fichiers dans app/sounds/, voir audio/local-soundfonts.js),
//      · échantillons « maison » (orgue, guitare, cordes, flûte… ; app/sounds/Bank/), une note tous les 3 demi-tons,
//        les notes intermédiaires sont obtenues en changeant la vitesse de lecture,
//      · synthé soustractif (audio/synth-voices.js), calculé en direct,
//      · patch FM à 6 opérateurs (audio/fm-synth.js), calculé note par note puis rejoué comme un petit échantillon.
//    Un petit synthé joue de secours tant qu'un échantillon charge ou si son fichier est introuvable.
//  - Chaque instrument a sa chaîne de sortie réglable (éditeur de son) : saturation, filtre, chorus, delay, panoramique,
//    volume, vibrato, envoi de réverbération.
// Chargé après soundfont-player, local-soundfonts.js, drum-synths.js, fm-synth.js, sound-lib.js et synth-voices.js.
// Aucun accès au DOM (hormis l'ajout d'une balise <script> pour lire un fichier d'échantillons).

const SeqAudio = (() => {
    // Un fichier d'échantillons « maison » en cours de lecture, partagé entre les moteurs : deux moteurs (le direct et
    // celui d'un export) ne lisent jamais deux fois le même fichier en même temps.
    const scriptInflight = {};

    // Instruments de la mélodie, dans l'ordre où on les propose.
    //   label : nom affiché · color : couleur des cases · shift : décalage d'octaves proposé au départ
    // Leurs sons possibles sont dans SoundLib.VOICES.
    const TIMBRES = {
        piano:     { label: 'Piano',          color: '#e2e8f0', shift: 0 },
        organ:     { label: 'Orgue',          color: '#f97316', shift: 0 },
        guitar:    { label: 'Guitare',        color: '#b8794b', shift: 0 },
        strings:   { label: 'Cordes',         color: '#f43f5e', shift: 0 },
        bass:      { label: 'Basse',          color: '#3b82f6', shift: -2 },
        synthbass: { label: 'Basse synthé',   color: '#f472b6', shift: -2 },
        trumpet:   { label: 'Trompette',      color: '#fbbf24', shift: 0 },
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
    const Lib = SoundLib;

    // Fabrique un moteur. Celui de l'appli (SeqAudio) en est un ; l'export en crée d'autres, qui jouent dans un contexte hors ligne.
    //   opts.offline : moteur d'export (aucun instrument chargé d'avance) · opts.banks : échantillons « maison » déjà décodés, partagés ·
    //   opts.sounds : son de chaque instrument · opts.vols : { drum, mel, track: { id: niveau } } · opts.bypassComp : sans le compresseur général
    function createEngine(opts) {
    opts = opts || {};
    let ctx = null, master, comp, drumBus, melBus, melRev, reverbIn, noiseBuf, satCurve, rt;
    const trackGain = {}, nodes = [], players = {}, ins = {}, insOn = {};
    const banks = opts.banks || {};                   // échantillons « maison » chargés : fichier → { state, keys, buf, promise }
    const sounds = Object.assign({}, opts.sounds), rev = {};                      // son (voir sound-lib.js) et numéro de version de chaque instrument
    const fmCache = new Map();                        // notes FM déjà calculées : clé → tampon (le plus ancien en tête)
    let fmCacheSize = 0;
    const FM_CACHE_MAX = 9e6;                         // échantillons gardés en mémoire (≈ 36 Mo)
    const ov = opts.vols || {};
    const vols = { track: Object.assign({}, ov.track), drum: ov.drum != null ? ov.drum : 0.8, mel: ov.mel != null ? ov.mel : 0.7 };
    let lastOpen = null, timbre = 'piano', voices = null, statusFn = () => {};
    const wanted = new Set(opts.offline ? [] : ['piano']);       // instruments dont la page a besoin (leurs échantillons sont chargés dès que le son démarre)

    const soundOf = (k) => sounds[k] || (sounds[k] = Lib.defaultSound(k));
    const voiceOf = (k) => Lib.voice(k, soundOf(k).voice);

    function buildReverb() {
        // Réverbération : bruit stéréo qui s'éteint en s'assombrissant (les aigus meurent avant les graves), après un
        // court silence. Sert aux cymbales et, instrument par instrument, à la mélodie.
        const sr = ctx.sampleRate, len = Math.floor(sr * 1.9), pre = Math.floor(sr * 0.012);
        const ir = ctx.createBuffer(2, len, sr);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            let lp = 0;
            for (let i = pre; i < len; i++) {
                const t = (i - pre) / sr;
                const a = 1 - Math.exp(-2 * Math.PI * (9000 * Math.exp(-t * 1.5) + 900) / sr);   // 9 kHz au début, ~1 kHz à la fin
                lp += a * ((Math.random() * 2 - 1) - lp);
                d[i] = lp * Math.exp(-t * 4.2) * Math.min(1, t / 0.02 + 0.15);
            }
        }
        const conv = ctx.createConvolver();
        conv.buffer = ir;
        reverbIn = ctx.createGain();
        const wet = ctx.createGain();
        wet.gain.value = 0.28;
        reverbIn.connect(conv); conv.connect(wet); wet.connect(master);
        melRev = ctx.createGain();                  // envois des instruments de la mélodie ; suit le volume de la mélodie
        melRev.gain.value = vols.mel;
        melRev.connect(reverbIn);
    }

    // `testCtx` : contexte audio fourni par les tests (OfflineAudioContext) ; sinon on en crée un.
    function init(testCtx) {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!testCtx && !AC) return false;
            if (!testCtx && typeof Keepalive !== 'undefined') Keepalive.setupAudioSession(); // iPhone : jouer même en mode silencieux
            ctx = testCtx || new AC();
            comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
            master = ctx.createGain();
            master.gain.value = 0.9;
            if (opts.bypassComp) master.connect(ctx.destination); else { master.connect(comp); comp.connect(ctx.destination); }
            drumBus = ctx.createGain(); drumBus.gain.value = vols.drum; drumBus.connect(master);
            melBus = ctx.createGain(); melBus.gain.value = vols.mel; melBus.connect(master);
            noiseBuf = makeNoiseBuffer(ctx);
            satCurve = makeSaturationCurve();
            buildReverb();
            const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
            rt = { ctx, tier: cores <= 2 ? 1 : 0, nodes, noise: () => noiseBuf, curve: () => satCurve, reverb: () => reverbIn };
            voices = createSynthVoices({ ctx, nodes, noise: () => noiseBuf, lib: Lib });
            if (!opts.offline) wanted.add(timbre);
            wanted.forEach(loadVoice);
        }
        if (ctx.resume && ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } // 'suspended' ou 'interrupted' (iOS)
        if (!testCtx && typeof Keepalive !== 'undefined') Keepalive.startSilentAudio();
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

    /* ---------- Mélodie : la chaîne de chaque instrument ---------- */
    // Chaque instrument passe par sa propre chaîne avant la mélodie :
    //   entrée (couper / isoler : M et S coupent aussi les notes déjà parties, comme une nappe tenue)
    //   → saturation → filtre passe-bas → ┬ direct ────────────────┐
    //                                    ├ chorus (deux retards qui ondulent, étalés à gauche et à droite) ┤→ panoramique → volume → mélodie
    //                                    └ delay (retard + répétitions) ┘                                    └→ envoi de réverbération
    // Un oscillateur lent (vibrato) est branché sur la hauteur de chaque note de l'instrument.
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
        c.mix = ctx.createGain();
        c.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        c.vol = ctx.createGain();
        c.dly = ctx.createDelay(1.5);
        c.fb = ctx.createGain();
        c.wet = ctx.createGain();
        c.inp.connect(c.pre); c.pre.connect(c.shaper); c.shaper.connect(c.post); c.post.connect(c.lp);
        c.lp.connect(c.mix);
        c.lp.connect(c.dly); c.dly.connect(c.wet); c.wet.connect(c.mix);
        c.dly.connect(c.fb); c.fb.connect(c.dly);
        // chorus
        c.chG = ctx.createGain();
        c.chG.connect(c.mix);
        c.chLfo = ctx.createOscillator(); c.chLfo.frequency.value = 0.55;
        [[0.019, 1, -0.8], [0.027, -1, 0.8]].forEach((p) => {
            const d = ctx.createDelay(0.1), depth = ctx.createGain();
            d.delayTime.value = p[0];
            depth.gain.value = 0.0032 * p[1];
            c.chLfo.connect(depth); depth.connect(d.delayTime);
            c.lp.connect(d);
            let tail = d;
            if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = p[2]; d.connect(pn); tail = pn; }
            tail.connect(c.chG);
        });
        c.chLfo.start();
        // vibrato : sortie en centièmes de ton, à brancher sur la propriété `detune` des notes
        c.vibLfo = ctx.createOscillator();
        c.vibAmt = ctx.createGain(); c.vibAmt.gain.value = 0;
        c.vibLfo.connect(c.vibAmt);
        c.vibLfo.start();
        if (c.pan) { c.mix.connect(c.pan); c.pan.connect(c.vol); } else c.mix.connect(c.vol);
        c.vol.connect(melBus);
        c.rev = ctx.createGain();
        c.vol.connect(c.rev); c.rev.connect(melRev);
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
    // Réglages de sortie d'un instrument (curseurs de l'éditeur, voir SoundLib.OUT) ; `now` : sans transition
    function applyOut(k, now) {
        const c = ins[k], o = soundOf(k).out;
        if (!c) return;
        const t = ctx.currentTime, tc = now ? 0 : 0.015;
        const set = (param, v) => { if (now) param.value = v; else param.setTargetAtTime(v, t, tc); };
        if (c.driveSet !== o.drv) { c.shaper.curve = driveCurve(o.drv); c.driveSet = o.drv; }
        set(c.post.gain, 0.25 / (1 + o.drv / 99 * 1.5));                 // la saturation gonfle le niveau : on le compense
        set(c.lp.frequency, Lib.cutHz(o.cut));
        set(c.lp.Q, o.res / 99 * 18);
        set(c.dly.delayTime, Lib.echoSec(o.dtime));
        set(c.fb.gain, o.dfb / 99 * 0.92);
        set(c.wet.gain, o.dmix / 99);
        set(c.chG.gain, o.cho / 99 * 0.95);
        set(c.vibLfo.frequency, Lib.vibHz(o.vrt));
        set(c.vibAmt.gain, Lib.vibCents(o.vib));
        set(c.rev.gain, o.rev / 99 * 2.5);
        if (c.pan) set(c.pan.pan, clamp((o.pan - 64) / 64, -1, 1));
        set(c.vol.gain, Math.pow(o.vol / 127, 2));
    }

    // Son d'un instrument (voir sound-lib.js) : on invalide ce qui avait été calculé pour l'ancien, on charge ce qu'il faut.
    function setSound(k, s) {
        if (!TIMBRES[k] || !s) return;
        sounds[k] = s;
        rev[k] = (rev[k] || 0) + 1;
        for (const key of Array.from(fmCache.keys())) {
            if (key.indexOf(k + '|') === 0) { fmCacheSize -= fmCache.get(key).length; fmCache.delete(key); }
        }
        if (ctx) {
            applyOut(k, false);
            if (wanted.has(k)) loadVoice(k);
            trimBanks();
        }
    }

    // Note FM : calculée une fois par (instrument, version du patch, hauteur, durée, force), puis gardée.
    function fmBuffer(k, midi, dur, vel) {
        const patch = soundOf(k).fm;
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

    /* ---------- Chargement des échantillons ---------- */
    // Pastille d'état : ce qui charge encore, ou ce qui manque (le synthé joue alors à la place).
    function refreshStatus() {
        const loading = [], failed = [];
        Object.keys(TIMBRES).forEach((k) => {
            if (!wanted.has(k)) return;
            const v = voiceOf(k);
            const st = v.kind === 'sf' ? (players[k] && players[k].state) : v.kind === 'bank' ? (banks[v.file] && banks[v.file].state) : null;
            if (st === 'loading') loading.push(TIMBRES[k].label);
            else if (st === 'failed') failed.push(TIMBRES[k].label);
        });
        if (loading.length) statusFn('Chargement : ' + loading.join(', ') + '…');
        else if (failed.length) statusFn('Son introuvable (' + failed.join(', ') + ') : synthé de secours');
        else statusFn('');
    }

    function loadTimbre(key) {                                    // échantillons soundfont-player (piano, basse, trompette)
        const v = voiceOf(key);
        if (v.kind !== 'sf' || !ctx) return Promise.resolve();
        const p = players[key] || (players[key] = { state: 'idle' });
        if (p.state === 'loading' || p.state === 'ready' || p.state === 'failed') return p.promise || Promise.resolve();
        if (typeof Soundfont === 'undefined') { p.state = 'failed'; refreshStatus(); return Promise.resolve(); }
        p.state = 'loading';
        refreshStatus();
        p.promise = Soundfont.instrument(ctx, v.sf, { soundfont: v.bank, format: 'mp3', destination: melBus })
            .then((inst) => { p.inst = inst; p.state = 'ready'; refreshStatus(); })
            .catch(() => { p.state = 'failed'; refreshStatus(); });
        return p.promise;
    }

    // Un fichier d'échantillons « maison » est un script qui dépose { meta, notes: { "48": "data:audio/mpeg;base64,…", … } }
    // dans window.SEQ_BANK[nom] ; on le lit comme un <script> (autorisé aussi quand la page est ouverte par double-clic).
    function readBankScript(file) {
        if (scriptInflight[file]) return scriptInflight[file];
        const pr = new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.async = true;
            el.onload = () => {
                const all = window.SEQ_BANK, data = all && all[file];
                if (all) delete all[file];
                el.remove();
                if (data && data.notes) resolve(data); else reject(new Error('Fichier de son vide : ' + file));
            };
            el.onerror = () => { el.remove(); reject(new Error('Fichier de son introuvable : ' + file)); };
            el.src = Lib.bankUrl(file);
            document.head.appendChild(el);
        });
        scriptInflight[file] = pr;
        const done = () => { delete scriptInflight[file]; };
        pr.then(done, done);
        return pr;
    }
    function dataUriBytes(uri) {
        const bin = atob(uri.slice(uri.indexOf(',') + 1)), n = bin.length, u = new Uint8Array(n);
        for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
        return u.buffer;
    }
    // Décodeur à 32 kHz : les échantillons sont des mp3 mono à 32 ou 44,1 kHz ; le contexte en jeu peut les rejouer tels quels
    // (le navigateur règle la vitesse), ce qui évite de les garder en 48 kHz dans la mémoire.
    let decoder = null;
    function decodeBytes(bytes) {
        if (!decoder) {
            const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            decoder = OAC ? new OAC(1, 1, 32000) : ctx;
        }
        return new Promise((res, rej) => {
            const p = decoder.decodeAudioData(bytes, res, rej);      // forme à rappel : Safari plus ancien
            if (p && p.catch) p.catch(rej);
        });
    }
    function loadBank(file) {
        if (!ctx) return Promise.resolve();
        const b = banks[file] || (banks[file] = { state: 'idle', keys: [], buf: {} });
        if (b.state !== 'idle') return b.promise || Promise.resolve();
        b.state = 'loading';
        refreshStatus();
        b.promise = readBankScript(file)
            .then((data) => Promise.all(Object.keys(data.notes).map((m) =>
                decodeBytes(dataUriBytes(data.notes[m])).then((buf) => { b.buf[+m] = buf; }))))
            .then(() => {
                b.keys = Object.keys(b.buf).map(Number).sort((x, y) => x - y);
                b.state = b.keys.length ? 'ready' : 'failed';
            })
            .catch(() => { b.state = 'failed'; })
            .then(refreshStatus);
        return b.promise;
    }
    // On libère la mémoire des échantillons dont plus aucun instrument ne se sert (l'utilisateur a changé de son).
    function trimBanks() {
        if (opts.banks) return;                 // échantillons partagés (export) : on ne libère rien
        const used = new Set();
        wanted.forEach((k) => { const v = voiceOf(k); if (v.kind === 'bank') used.add(v.file); });
        Object.keys(banks).forEach((f) => { if (!used.has(f) && banks[f].state !== 'loading') delete banks[f]; });
    }

    function loadVoice(k) {
        const v = voiceOf(k);
        if (v.kind === 'sf') return loadTimbre(k);
        if (v.kind === 'bank') return loadBank(v.file);
        return Promise.resolve();
    }

    // Annonce les instruments utilisés par la mélodie : leurs échantillons sont chargés (tout de suite si le son est
    // déjà démarré, sinon au démarrage).
    function want(keys) {
        keys.forEach((k) => { if (TIMBRES[k]) { wanted.add(k); if (ctx) loadVoice(k); } });
    }

    // Instrument « par défaut » (celui qu'on entend en écoutant une note, ou quand une note n'en précise pas).
    function setTimbre(key) {
        if (!TIMBRES[key]) return;
        timbre = key;
        want([key]);
        refreshStatus();
    }

    /* ---------- Jouer une note ---------- */
    // Le vibrato de l'instrument est branché sur la hauteur de la note tant qu'elle sonne.
    function vibrato(c, o, node) {
        if (!(o.vib > 0) || !node.detune) return;
        c.vibAmt.connect(node.detune);
        const un = () => { try { c.vibAmt.disconnect(node.detune); } catch (e) { /* déjà débranché */ } };
        node.addEventListener ? node.addEventListener('ended', un) : (node.onended = un);
    }

    // Enveloppe d'une note d'échantillon : attaque, tenue pendant `hold`, puis relâchement.
    function sampleEnv(g, when, hold, peak, o) {
        const A = Math.min(Math.max(Lib.attSec(o.att), 0.003), hold * 0.6), R = Lib.relSec(o.rel);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(peak, when + A);
        g.gain.setValueAtTime(peak, when + hold);
        g.gain.setTargetAtTime(0, when + hold, R / 4);
        return when + hold + R * 1.5 + 0.05;
    }

    function nearestKey(keys, midi) {
        let best = keys[0], d = Math.abs(midi - best);
        for (let i = 1; i < keys.length; i++) {
            const e = Math.abs(midi - keys[i]);
            if (e < d) { d = e; best = keys[i]; }
        }
        return best;
    }

    // Boucle de maintien d'un échantillon « tenu » (flûte, orgue, cordes, chœur…) : une note plus longue que l'enregistrement
    // (3 à 4 s) continue en bouclant sa partie stable, au lieu de s'éteindre. Le point d'arrivée est cherché là où la fin de la
    // boucle ressemble le plus à son début, pour que le raccord ne s'entende pas. Un son qui décroît (pincé, frappé) n'a pas de boucle.
    const loopCache = new WeakMap();
    function loopOf(buf) {
        if (!buf) return null;
        if (loopCache.has(buf)) return loopCache.get(buf);
        let lp = null;
        try { lp = findLoop(buf); } catch (e) { lp = null; }
        loopCache.set(buf, lp);
        return lp;
    }
    function findLoop(buf) {
        const x = buf.getChannelData(0), sr = buf.sampleRate, n = x.length;
        const win = Math.round(0.05 * sr), nw = Math.floor(n / win);
        if (nw < 16) return null;
        const rms = [];
        for (let w = 0; w < nw; w++) { let s = 0; for (let i = w * win, e = i + win; i < e; i++) s += x[i] * x[i]; rms.push(Math.sqrt(s / win)); }
        const mid = rms.slice(Math.floor(nw * 0.25), Math.floor(nw * 0.65)).sort((a, b) => a - b);
        const ref = mid[mid.length >> 1];
        if (!(ref > 1e-4)) return null;
        let a = 0; while (a < nw && rms[a] < 0.8 * ref) a++;
        let z = nw - 3; while (z > a && rms[z] < 0.8 * ref) z--;           // on laisse de côté les 150 dernières ms (relâchement)
        const ls = (a + 2) * win, maxEnd = Math.min((z + 1) * win, n - 1);
        if (maxEnd - ls < 0.5 * sr) return null;                           // pas de partie stable : son qui décroît
        const le0 = Math.min(maxEnd, ls + Math.round(2 * sr));
        const W = 768, lo = Math.max(ls + Math.round(0.4 * sr), le0 - Math.round(0.12 * sr));
        let eA = 0; for (let i = 0; i < W; i++) eA += x[ls - W + i] * x[ls - W + i];
        let best = le0, bs = -2;
        for (let e = le0; e >= lo; e -= 2) {
            let dot = 0, eB = 0;
            for (let i = 0; i < W; i++) { const y = x[e - W + i]; dot += y * x[ls - W + i]; eB += y * y; }
            const sc = dot / Math.sqrt(eA * eB + 1e-12);
            if (sc > bs) { bs = sc; best = e; }
        }
        // fondu enchaîné : la fin de la boucle est mélangée peu à peu avec ce qui précède son début, si bien que le retour au début
        // continue la courbe sans saut (pas de « clic » au raccord)
        const xf = Math.min(Math.round(0.03 * sr), ls - 1, best - ls - 1);
        for (let i = 0; i < xf; i++) {
            const w = (i + 1) / (xf + 1), a = best - xf + i, b = ls - xf + i;
            for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); d[a] = d[a] * (1 - w) + d[b] * w; }
        }
        return { s: ls / sr, e: best / sr };
    }

    // fx : verrous du pas (voir fxInput), ou rien · key : instrument de la note (sinon l'instrument par défaut)
    // vel : force de la note (0,9 = normale) · trim : niveau de l'instrument dans le mélange (1 = d'origine)
    // legato : la note enchaîne sur la précédente du même instrument (fin de boucle) : attaque courte, pour un raccord sans trou
    function playNote(midi, when, dur, vel, fx, key, trim, legato) {
        if (!ctx) return;
        const k = TIMBRES[key] ? key : timbre;
        const snd = soundOf(k), v = Lib.voice(k, snd.voice), c = insChain(k);
        const o = legato ? Object.assign({}, snd.out, { att: Math.min(snd.out.att, 30) }) : snd.out;
        const out = fx ? fxInput(c.inp, fx) : c.inp;
        const tr = trim == null ? 1 : trim, tune = o.tune || 0, level = vel * tr;
        let played = false;
        if (v.kind === 'sf') {
            const p = players[k];
            if (p && p.state === 'ready') {
                const opt = { duration: dur, gain: level, destination: out, adsr: [Lib.attSec(o.att), 0.1, 0.9, Lib.relSec(o.rel)] };
                if (tune) opt.cents = tune;
                try { p.inst.play(Theory.midiName(midi), when, opt); played = true; } catch (e) { /* on retombe sur le synthé */ }
            } else if (!p || p.state === 'idle') {
                want([k]);
            }
        } else if (v.kind === 'bank') {
            const b = banks[v.file];
            if (b && b.state === 'ready') {
                const nk = nearestKey(b.keys, midi), src = ctx.createBufferSource(), g = ctx.createGain();
                src.buffer = b.buf[nk];
                src.playbackRate.value = Math.pow(2, (midi - nk) / 12);
                const lp = v.hold ? null : loopOf(src.buffer);        // son tenu : on boucle sa partie stable si la note dépasse l'échantillon
                if (lp) { src.loop = true; src.loopStart = lp.s; src.loopEnd = lp.e; }
                if (tune) src.detune.value = tune;
                vibrato(c, o, src);
                const stop = sampleEnv(g, when, Math.max(dur, v.hold || 0.04), level, o);
                src.connect(g); g.connect(out);
                src.start(when);
                src.stop(stop);
                nodes.push(src);
                played = true;
            } else if (!b || b.state === 'idle') {
                want([k]);
            }
        } else if (v.kind === 'synth') {
            voices.play(snd.syn, o, v.lvl, midi, when, Math.max(dur, v.hold || 0.04), level, out, (osc) => vibrato(c, o, osc));
            played = true;
        } else if (v.kind === 'fm') {
            let buf = null;
            try { buf = fmBuffer(k, midi, dur, vel); } catch (e) { buf = null; }
            if (buf) {
                const src = ctx.createBufferSource(), g = ctx.createGain();
                src.buffer = buf;
                if (tune) src.detune.value = tune;
                vibrato(c, o, src);
                g.gain.value = level;
                src.connect(g); g.connect(out);
                src.start(when);
                nodes.push(src);
                played = true;
            }
        }
        if (!played) voices.fallback(midi, when, dur, level, out);       // en attendant l'échantillon (ou s'il manque)
        prune();
    }

    // Clic de métronome : un petit « tic » (plus aigu sur le premier temps), directement sur la sortie générale
    function click(when, accent) {
        if (!ctx) return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = accent ? 1760 : 1175;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
        o.connect(g); g.connect(master);
        o.start(when); o.stop(when + 0.06);
        nodes.push(o);
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
        if (melRev) melRev.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
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
        create: createEngine,
        // Promesse tenue quand tous les échantillons demandés sont chargés (ou ont échoué : le synthé de secours joue alors)
        whenLoaded() { return Promise.all(Array.from(wanted).map((k) => loadVoice(k))); },
        TIMBRES, init, now, get, playDrum, playNote, click, setTimbre, want, setInstrumentAudible, setSound, setTrackVolume, setDrumVolume, setMelodyVolume, stopAll,
        // Pour l'éditeur : ce qui charge encore (« idle » / « loading » / « ready » / « failed »), pour un instrument
        loadState(k) {
            const v = voiceOf(k);
            if (v.kind === 'sf') return (players[k] && players[k].state) || 'idle';
            if (v.kind === 'bank') return (banks[v.file] && banks[v.file].state) || 'idle';
            return 'ready';
        },
        onStatus(fn) { statusFn = fn || (() => {}); }
    };
    }

    const main = createEngine();
    return main;
})();
