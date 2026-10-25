// synth-voices.js — instruments synthétisés de la mélodie (aucun fichier de son à charger : tout est calculé par le
// navigateur, donc disponible tout de suite et hors ligne). Les instruments à échantillons (piano, trompette, basse)
// restent dans audio-engine.js ; ceux-ci les complètent.
//
// createSynthVoices({ ctx, nodes, noise }) renvoie { <identifiant>: voix }, où chaque voix se joue ainsi :
//     voix(midi, when, dur, vel, out)
//   midi : numéro de note · when : instant de départ (horloge du contexte audio) · dur : durée tenue, en secondes
//   vel : force (0–1) · out : nœud où brancher le son
// ctx : le contexte audio · nodes : liste où l'on range les sources pour pouvoir tout arrêter · noise : () => tampon de bruit blanc.
// Aucun accès au DOM. Chargé avant audio-engine.js.

function createSynthVoices(host) {
    const ctx = host.ctx, nodes = host.nodes;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    // Onde à harmoniques choisies { rang : amplitude } (orgue, clarinette…), gardée une fois créée.
    const waves = {};
    function wave(name, partials) {
        if (!waves[name]) {
            const n = Math.max.apply(null, Object.keys(partials).map(Number)) + 1;
            const re = new Float32Array(n), im = new Float32Array(n);
            Object.keys(partials).forEach((h) => { im[h] = partials[h]; });
            waves[name] = ctx.createPeriodicWave(re, im);
        }
        return waves[name];
    }

    // Oscillateur déjà programmé (départ t0, arrêt t1) ; shape : 'sine', 'sawtooth'… ou une onde de wave().
    function osc(shape, freq, cents, t0, t1) {
        const o = ctx.createOscillator();
        if (typeof shape === 'string') o.type = shape; else o.setPeriodicWave(shape);
        o.frequency.value = freq;
        if (cents) o.detune.value = cents;
        o.start(t0);
        o.stop(t1);
        nodes.push(o);
        return o;
    }

    // Enveloppe tenue : montée a, descente d jusqu'au niveau de maintien sus (0–1 du sommet), puis relâchement r
    // à la fin de la durée tenue. Renvoie l'instant où le son est éteint.
    function adsr(gain, t, dur, peak, a, d, sus, r) {
        const hold = Math.max(dur, 0.05);
        const aa = Math.min(a, hold * 0.6);
        const dd = Math.min(d, hold - aa);
        const lvl = d > 0 ? peak * Math.pow(Math.max(sus, 0.001), dd / d) : peak;
        const g = gain.gain;
        g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(peak, t + aa);
        if (dd > 0.001) g.exponentialRampToValueAtTime(Math.max(lvl, 0.0001), t + aa + dd);
        g.setValueAtTime(Math.max(lvl, 0.0001), t + hold);
        g.exponentialRampToValueAtTime(0.0001, t + hold + r);
        return t + hold + r;
    }

    // Enveloppe qui sonne jusqu'au bout, sans tenir compte de la durée (touches frappées : marimba, cloches…).
    function ring(gain, t, peak, attack, T) {
        const g = gain.gain;
        g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(peak, t + attack);
        g.exponentialRampToValueAtTime(0.0001, t + T);
        return t + T;
    }

    // Vibrato : un oscillateur lent module la hauteur (en cents) de `targets`, après un petit délai.
    function vibrato(targets, rate, cents, t0, t1, delay) {
        const lfo = osc('sine', rate, 0, t0, t1), depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t0);
        depth.gain.setValueAtTime(0, t0 + delay);
        depth.gain.linearRampToValueAtTime(cents, t0 + delay + 0.3);
        lfo.connect(depth);
        targets.forEach((o) => depth.connect(o.detune));
    }

    function lowpass(freq, q) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = clamp(freq, 60, 18000);
        lp.Q.value = q;
        return lp;
    }
    const amp = (v) => { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; };

    // Souffle : bruit blanc filtré, branché sur `dest`.
    function breath(t0, t1, freq, level, dest) {
        const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = amp(level);
        src.buffer = host.noise();
        src.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = clamp(freq, 200, 12000); bp.Q.value = 1.2;
        src.connect(bp); bp.connect(g); g.connect(dest);
        src.start(t0);
        src.stop(t1);
        nodes.push(src);
    }

    /* ---------- Corde pincée (Karplus-Strong) ---------- */
    // Une boucle de retard avec un filtre moyenneur imite une corde : on la calcule une fois par note et par durée,
    // dans un tampon qu'on rejoue ensuite en corrigeant sa hauteur par la vitesse de lecture.
    const plucks = new Map();
    function pluckBuffer(m, t60, tone) {
        const key = m + ':' + t60 + ':' + tone;
        let buf = plucks.get(key);
        if (buf) return buf;
        const sr = ctx.sampleRate, f = hz(m);
        const L = Math.max(2, Math.round(sr / f - 0.5));              // le filtre moyenneur ajoute un demi-échantillon
        const len = Math.floor(sr * Math.min(3.2, t60 * 1.15));
        buf = ctx.createBuffer(1, len, sr);
        const y = buf.getChannelData(0);
        let prev = 0, mean = 0;
        for (let i = 0; i <= L; i++) {                                  // coup de plectre : bruit plus ou moins adouci
            prev += tone * ((Math.random() * 2 - 1) - prev);
            y[i] = prev;
            mean += prev;
        }
        mean /= L + 1;
        for (let i = 0; i <= L; i++) y[i] -= mean;
        const damp = Math.pow(10, -3 / (t60 * f));                      // −60 dB au bout de t60 secondes
        let peak = 0;
        for (let i = L + 1; i < len; i++) y[i] = damp * 0.5 * (y[i - L] + y[i - L - 1]);
        for (let i = 0; i < len; i++) if (Math.abs(y[i]) > peak) peak = Math.abs(y[i]);
        const k = peak > 0 ? 0.9 / peak : 1, fade = Math.floor(sr * 0.04);
        for (let i = 0; i < len; i++) y[i] *= k * (i > len - fade ? (len - i) / fade : 1);
        buf.__rate = f * (L + 0.5) / sr;                                // vitesse de lecture qui remet la note à sa hauteur
        if (plucks.size > 90) plucks.clear();
        plucks.set(key, buf);
        return buf;
    }

    const voices = {
        // Synthé (le son de secours historique) : deux oscillateurs filtrés.
        synth(m, t, dur, vel, out) {
            const f = hz(m), hold = Math.max(dur, 0.04), g = amp(0), lp = lowpass(Math.min(f * 7, 9000), 0.7);
            lp.frequency.setValueAtTime(Math.min(f * 7, 9000), t);
            lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 500), t + hold);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.01);
            g.gain.setValueAtTime(0.2 * vel, t + hold);
            g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.15);
            osc('triangle', f, 0, t, t + hold + 0.2).connect(lp);
            osc('sawtooth', f, 6, t, t + hold + 0.2).connect(lp);
            lp.connect(g); g.connect(out);
        },

        // Orgue : harmoniques façon tirettes, deux voix à peine désaccordées.
        organ(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), w = wave('organ', { 1: 1, 2: 0.75, 3: 0.5, 4: 0.3, 6: 0.18, 8: 0.1 });
            const end = adsr(g, t, dur, 0.2 * vel, 0.012, 0, 1, 0.07);
            [-4, 4].forEach((c) => osc(w, f, c, t, end + 0.05).connect(g));
            g.connect(out);
        },

        // Guitare : corde pincée, assez ronde.
        guitar(m, t, dur, vel, out) {
            const buf = pluckBuffer(m, 1.5, 0.5), src = ctx.createBufferSource(), lp = lowpass(4200, 0.5), g = amp(0.7 * vel);
            src.buffer = buf;
            src.playbackRate.value = buf.__rate;
            src.connect(lp); lp.connect(g); g.connect(out);
            src.start(t);
            nodes.push(src);
        },

        // Cordes : trois dents de scie désaccordées, attaque lente, vibrato.
        strings(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), lp = lowpass(Math.min(f * 4 + 800, 6000), 0.4);
            const end = adsr(g, t, dur, 0.1 * vel, 0.13, 0, 1, 0.4);
            const os = [-9, 0, 9].map((c) => osc('sawtooth', f, c, t, end + 0.05));
            os.forEach((o) => o.connect(lp));
            vibrato(os, 5.3, 7, t, end + 0.05, 0.2);
            lp.connect(g); g.connect(out);
        },

        // Basse synthétique : dent de scie + sous-octave, filtre résonant qui se ferme vite.
        synthbass(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), lp = lowpass(Math.min(f * 10, 5000), 5), sub = amp(0.6);
            lp.frequency.setValueAtTime(Math.min(f * 10, 5000), t);
            lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.3, 120), t + 0.22);
            const end = adsr(g, t, dur, 0.28 * vel, 0.004, 0.18, 0.55, 0.07);
            osc('sawtooth', f, 0, t, end + 0.05).connect(lp);
            osc('sine', f / 2, 0, t, end + 0.05).connect(sub);
            sub.connect(lp); lp.connect(g); g.connect(out);
        },

        // Flûte : sinus presque pur, un peu de souffle, vibrato qui s'installe.
        flute(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), h2 = amp(0.16);
            const end = adsr(g, t, dur, 0.32 * vel, 0.05, 0.1, 0.85, 0.1);
            const o = osc('sine', f, 0, t, end + 0.05);
            o.connect(g);
            osc('sine', f * 2, 0, t, end + 0.05).connect(h2); h2.connect(g);
            breath(t, end + 0.05, f * 3, 0.07, g);
            vibrato([o], 5, 7, t, end + 0.05, 0.2);
            g.connect(out);
        },

        // Clarinette : harmoniques impaires, filtre doux.
        clarinet(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), lp = lowpass(f * 9, 0.5), w = wave('clarinet', { 1: 1, 2: 0.04, 3: 0.5, 5: 0.28, 7: 0.14, 9: 0.07 });
            const end = adsr(g, t, dur, 0.3 * vel, 0.03, 0.1, 0.85, 0.07);
            osc(w, f, 0, t, end + 0.05).connect(lp);
            breath(t, end + 0.05, f * 4, 0.025, lp);
            lp.connect(g); g.connect(out);
        },

        // Marimba : sinus + harmonique 4 qui s'éteint plus vite ; sonne jusqu'au bout.
        marimba(m, t, dur, vel, out) {
            const f = hz(m), T = clamp(1.4 - f / 900, 0.3, 1.3);
            const parts = [[1, 0.55, T], [4, 0.22, T * 0.25], [9.9, 0.07, 0.05]];
            parts.forEach((p) => {
                const g = amp(0);
                osc('sine', f * p[0], 0, t, ring(g, t, p[1] * vel, 0.003, p[2]) + 0.05).connect(g);
                g.connect(out);
            });
        },

        // Vibraphone : sinus, harmonique 4, trémolo lent, longue résonance.
        vibes(m, t, dur, vel, out) {
            const f = hz(m), T = clamp(2.6 - f / 700, 0.6, 2.4), trem = amp(0.75), lfoDepth = amp(0.25);
            const lfo = osc('sine', 5, 0, t, t + T + 0.1);
            lfo.connect(lfoDepth); lfoDepth.connect(trem.gain);
            [[1, 0.5, T], [4, 0.12, T * 0.22]].forEach((p) => {
                const g = amp(0);
                osc('sine', f * p[0], 0, t, ring(g, t, p[1] * vel, 0.004, p[2]) + 0.05).connect(g);
                g.connect(trem);
            });
            trem.connect(out);
        },

        // Carillon : modulation de fréquence (rapport 3,5) dont l'éclat retombe, longue résonance.
        bells(m, t, dur, vel, out) {
            const f = hz(m), T = clamp(3.2 - f / 500, 0.8, 3), g = amp(0), mg = amp(0);
            const car = osc('sine', f, 0, t, t + T + 0.1), mod = osc('sine', f * 3.5, 0, t, t + T + 0.1);
            mg.gain.setValueAtTime(f * 3, t);
            mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.2);
            mod.connect(mg); mg.connect(car.frequency);
            ring(g, t, 0.34 * vel, 0.002, T);
            car.connect(g);
            const g2 = amp(0);
            osc('sine', f * 2, 0, t, ring(g2, t, 0.12 * vel, 0.002, T * 0.5) + 0.05).connect(g2);
            g2.connect(out); g.connect(out);
        },

        // Chiptune : onde carrée nette, enveloppe courte.
        chip(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), lp = lowpass(5200, 0.5);
            const end = adsr(g, t, dur, 0.1 * vel, 0.002, 0.06, 0.65, 0.03);
            const o = osc('square', f, 0, t, end + 0.05);
            o.connect(lp);
            vibrato([o], 6, 10, t, end + 0.05, 0.25);
            lp.connect(g); g.connect(out);
        },

        // Nappe : ondes douces désaccordées, attaque et relâchement lents.
        pad(m, t, dur, vel, out) {
            const f = hz(m), g = amp(0), lp = lowpass(f * 2.5 + 400, 0.6);
            const end = adsr(g, t, dur, 0.15 * vel, 0.35, 0, 1, 0.7);
            osc('triangle', f, -12, t, end + 0.05).connect(lp);
            osc('sawtooth', f, 0, t, end + 0.05).connect(lp);
            osc('triangle', f, 12, t, end + 0.05).connect(lp);
            lp.connect(g); g.connect(out);
        }
    };

    // Niveau de chaque voix, réglé pour sonner à peu près aussi fort que les instruments à échantillons
    // (mesuré sur le rendu d'un Do à 0,5 s : volume moyen ≈ 0,04).
    const LEVEL = {
        synth: 0.28, organ: 0.29, guitar: 0.57, strings: 0.65, synthbass: 0.33, flute: 0.23, clarinet: 0.24,
        marimba: 0.31, vibes: 0.29, bells: 0.31, chip: 0.78, pad: 0.5
    };
    const leveled = {};
    Object.keys(voices).forEach((k) => {
        leveled[k] = (m, t, dur, vel, out) => {
            const g = amp(LEVEL[k] || 0.3);
            g.connect(out);
            voices[k](m, t, dur, vel, g);
        };
    });
    return leveled;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSynthVoices };
}
