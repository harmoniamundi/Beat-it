// synth-voices.js — le synthé soustractif de la mélodie (aucun fichier de son à charger : tout est calculé en direct
// par le navigateur, donc disponible tout de suite et hors ligne).
//
//   oscillateurs (1 à 5 voix désaccordées, + sous-octave)  →  filtre passe-bas qui s'ouvre au début de chaque note
//   →  enveloppe de volume (attaque, descente, maintien, relâchement)  →  sortie
//
// createSynthVoices({ ctx, nodes, noise }) renvoie :
//   play(syn, o, lvl, midi, when, dur, vel, out, hook)  une note du synthé, avec les réglages `syn` (voir sound-lib.js, SYN)
//       et `o` (réglages communs : attaque, relâchement, accord) ; lvl : niveau propre au son ; hook(osc) : appelé pour
//       chaque oscillateur (le moteur y branche le vibrato)
//   fallback(midi, when, dur, vel, out)  un petit synthé de secours, joué tant qu'un échantillon charge
// midi : numéro de note · when : instant de départ (horloge du contexte audio) · dur : durée tenue, en secondes
// vel : force (0–1) · out : nœud où brancher le son.
// ctx : le contexte audio · nodes : liste où l'on range les sources pour pouvoir tout arrêter.
// Aucun accès au DOM. Chargé après sound-lib.js, avant audio-engine.js.

function createSynthVoices(host) {
    const ctx = host.ctx, nodes = host.nodes, L = host.lib;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const amp = (v) => { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; };

    // Impulsion de largeur w (1 = tout le cycle) : série de Fourier, en 160 harmoniques (le navigateur coupe celles qui
    // dépasseraient la moitié de la fréquence d'échantillonnage).
    const pulses = {};
    function pulseWave(pw) {
        const key = Math.round(pw);
        if (!pulses[key]) {
            const d = key / 100, N = 160, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
            for (let n = 1; n <= N; n++) {
                const a = 2 * Math.sin(n * Math.PI * d) / (n * Math.PI);
                re[n] = a * Math.cos(n * Math.PI * d);
                im[n] = a * Math.sin(n * Math.PI * d);
            }
            pulses[key] = ctx.createPeriodicWave(re, im);
        }
        return pulses[key];
    }
    const TYPE = { saw: 'sawtooth', square: 'square', tri: 'triangle', sine: 'sine' };

    function osc(wave, pw, freq, cents, t0, t1) {
        const o = ctx.createOscillator();
        if (wave === 'pulse') o.setPeriodicWave(pulseWave(pw)); else o.type = TYPE[wave] || 'sawtooth';
        o.frequency.value = freq;
        if (cents) o.detune.value = cents;
        o.start(t0);
        o.stop(t1);
        nodes.push(o);
        return o;
    }

    function play(syn, o, lvl, m, t, dur, vel, out, hook) {
        const f = hz(m), hold = Math.max(dur, 0.04);
        const A = Math.min(Math.max(L.attSec(o.att), 0.003), hold * 0.6), R = L.relSec(o.rel);
        const tEnd = t + hold, stop = tEnd + R * 1.5 + 0.05;
        const peak = Math.max(0.0001, vel * (lvl || 1));
        const sus = syn.sus / 99, T = L.decSec(syn.dec) / 3;
        const g = amp(0);
        const gp = g.gain;
        // enveloppe de volume
        gp.setValueAtTime(0.0001, t);
        gp.linearRampToValueAtTime(peak, t + A);
        let at = peak;                                              // niveau atteint à la fin de la note
        if (sus < 0.995) {
            gp.setTargetAtTime(Math.max(peak * sus, 0.0001), t + A, T);
            at = peak * sus + (peak - peak * sus) * Math.exp(-(hold - A) / T);
        }
        gp.setValueAtTime(Math.max(at, 0.0001), tEnd);
        gp.setTargetAtTime(0, tEnd, R / 4);
        // oscillateurs
        const n = syn.uni, mix = amp(1 / Math.sqrt(n)), tune = o.tune || 0;
        for (let i = 0; i < n; i++) {
            const c = n === 1 ? 0 : -syn.det + 2 * syn.det * i / (n - 1);
            const os = osc(syn.wave, syn.pw, f, c + tune, t, stop);
            os.connect(mix);
            if (hook) hook(os);
        }
        if (syn.sub > 0) {
            const sub = osc('sine', 50, f / 2, tune, t, stop), sg = amp(syn.sub / 99 * 0.9);
            sub.connect(sg); sg.connect(mix);
            if (hook) hook(sub);
        }
        // filtre
        let head = mix;
        if (syn.fc < 97 || syn.fenv > 0) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.Q.value = 0.5 + syn.q / 99 * 14;
            const base = clamp(f * Math.pow(2, 0.5 + syn.fc / 99 * 7), 80, 19000);
            const top = clamp(base * Math.pow(2, syn.fenv / 99 * 6), base, 19000);
            lp.frequency.setValueAtTime(top, t);
            if (top > base) lp.frequency.setTargetAtTime(base, t, L.decSec(syn.fdec) / 3);
            head.connect(lp);
            head = lp;
        }
        head.connect(g);
        g.connect(out);
    }

    // Synthé de secours (le son historique de l'appli) : deux oscillateurs filtrés.
    function fallback(m, t, dur, vel, out) {
        const f = hz(m), hold = Math.max(dur, 0.04), g = amp(0), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 0.7;
        lp.frequency.setValueAtTime(Math.min(f * 7, 9000), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 500), t + hold);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.056 * vel, t + 0.01);
        g.gain.setValueAtTime(0.056 * vel, t + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.15);
        osc('triangle', 0, f, 0, t, t + hold + 0.2).connect(lp);
        osc('sawtooth', 0, f, 6, t, t + hold + 0.2).connect(lp);
        lp.connect(g); g.connect(out);
    }

    return { play, fallback };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSynthVoices };
}
