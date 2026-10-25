// audio/drum-synths.js — synthèse des percussions du groupe (grosse caisse, caisse claire, charleston, cymbales, toms, percussions
// latines, fanfare, Balkans, tango), en Web Audio pur : aucune dépendance au moteur ni au DOM.
// Chaque synthé reçoit un « rt » (runtime audio) décrivant l'environnement de synthèse :
//   rt.ctx      contexte audio (AudioContext, ou OfflineAudioContext pour les percussions pré-calculées)
//   rt.tier     niveau de qualité (0 complet, 1 allégé, 2 minimal)
//   rt.nodes    tableau où l'on range les sources démarrées (pour pouvoir les couper à l'arrêt)
//   rt.noise()  tampon de bruit blanc partagé ;  rt.curve()  courbe de saturation partagée
//   rt.reverb() entrée de la réverbération des cymbales
// puis (time, destination, …). Chargé par index.html via <script src="audio/drum-synths.js"> et testé par
// audio/drum-synths.test.js avec un faux contexte audio qui enregistre les nœuds créés.

// Tampon de bruit blanc d'une seconde.
function makeNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}

// Courbe de saturation douce (waveshaper) utilisée pour donner du corps
// et un peu de grain analogique à la grosse caisse et à la caisse claire.
function makeSaturationCurve() {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.tanh(2.2 * x);
    }
    return curve;
}

// Retourne { drum, mul, freq, short, name, variants, maxDur, long } décrivant l'échantillon d'un coup, ou null.
function drumSpec(e) {
    let drum = e.drum, mul = 1;
    if (drum === 'pedal') { drum = 'hat'; mul = 0.8; }
    const MAXDUR = { kick: 0.5, snare: 0.35, ghost: 0.25, hat: 0.15, ohat: 0.65, ride: 1.3, crash: 2.9, clash: 1.1, rim: 0.12,
        tom1: 0.45, tom2: 0.45, tom3: 0.45, bell: 0.3, clave: 0.15, conga1: 0.2, conga2: 0.4, slap: 0.15, shaker: 0.12,
        bdrum: 0.75, golpe: 0.25, chich: 0.3, latigo: 0.3, dum: 0.7, tek: 0.7, ka: 0.7, tapan: 0.7, stick: 0.7, daire: 0.7 };
    let maxDur = MAXDUR[drum], name = drum, freq, short;
    if (drum === 'timp') {
        freq = e.freq || 98; short = !!e.short;
        maxDur = short ? 0.75 : 2.1;
        name = 'timp' + freq + (short ? 's' : 'l');
    }
    if (!maxDur) return null;
    const variants = (drum === 'snare' || drum === 'ghost' || drum === 'tom1' || drum === 'tom2' || drum === 'tom3') ? 2 : 1; // hauteur légèrement aléatoire à chaque coup
    return { drum, mul, freq, short, name, variants, maxDur, long: maxDur >= 0.8 };
}

// Joue un coup de percussion décrit par e ({ drum, freq?, short? }) avec la synthèse correspondante.
function synthDrumLive(rt, e, time, dest, v) {
    switch (e.drum) {
        case 'kick': synthKick(rt, time, dest, v); break;
        case 'snare': synthSnare(rt, time, dest, false, v); break;
        case 'ghost': synthSnare(rt, time, dest, true, v); break;
        case 'hat': synthHihat(rt, time, dest, false, v); break;
        case 'pedal': synthHihat(rt, time, dest, false, v * 0.8); break;
        case 'ohat': synthHihat(rt, time, dest, true, v); break;
        case 'ride': synthCymbal(rt, time, dest, 1.0, v, 5500); break;
        case 'crash': synthCymbal(rt, time, dest, 2.6, v, 3500); break;
        case 'rim': synthRim(rt, time, dest, v); break;
        case 'tom1': synthTom(rt, time, dest, 160, v); break;
        case 'tom2': synthTom(rt, time, dest, 120, v); break;
        case 'tom3': synthTom(rt, time, dest, 88, v); break;
        case 'bell': synthCowbell(rt, time, dest, v); break;
        case 'clave': synthClave(rt, time, dest, v); break;
        case 'conga1': synthConga(rt, time, dest, 430, 0.1, v); break;
        case 'conga2': synthConga(rt, time, dest, 300, 0.3, v); break;
        case 'slap': synthSlap(rt, time, dest, v); break;
        case 'shaker': synthShaker(rt, time, dest, v); break;
        case 'bdrum': synthBassDrum(rt, time, dest, v); break;
        case 'timp': synthTimp(rt, time, dest, e.freq || 98, v, e.short ? 0.5 : 1.8); break;
        case 'clash': synthCymbal(rt, time, dest, 0.8, v, 4200); break;
        case 'golpe': synthGolpe(rt, time, dest, v); break;
        case 'chich': synthChicharra(rt, time, dest, v); break;
        case 'latigo': synthLatigo(rt, time, dest, v); break;
        case 'dum': case 'tek': case 'ka': case 'tapan': case 'stick': case 'daire': synthDarbuka(rt, time, dest, e.drum, v); break;
    }
}

function synthKick(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;

    // Corps : sinus avec chute de hauteur, légèrement saturé pour plus de punch,
    // et un filtre passe-bas pour retirer l'agressivité numérique.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
    const shaper = ctx.createWaveShaper();
    shaper.curve = rt.curve();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(vel, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    if (rt.tier >= 2) {
        // Niveau minimal : sinus + passe-bas seulement (ni saturation ni clic d'attaque)
        osc.connect(lp); lp.connect(gain); gain.connect(destination);
        osc.start(time); osc.stop(time + 0.34);
        rt.nodes.push(osc);
        return;
    }
    osc.connect(shaper); shaper.connect(lp); lp.connect(gain); gain.connect(destination);
    osc.start(time); osc.stop(time + 0.34);
    rt.nodes.push(osc);

    // Attaque : clic du battant sur la peau (bruit filtré très bref)
    const click = ctx.createBufferSource();
    click.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.7;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.001, time);
    clickGain.gain.exponentialRampToValueAtTime(0.45 * vel, time + 0.001);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
    click.connect(bp); bp.connect(clickGain); clickGain.connect(destination);
    click.start(time); click.stop(time + 0.025);
    rt.nodes.push(click);
}

function synthSnare(rt, time, destination, soft = false, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const dur = soft ? 0.13 : 0.2;

    // Bruit "timbre" (cordes de caisse claire), autour de 3 kHz
    const wire = ctx.createBufferSource();
    wire.buffer = rt.noise();
    const wireBP = ctx.createBiquadFilter();
    wireBP.type = 'bandpass'; wireBP.frequency.value = 3200; wireBP.Q.value = 0.6;
    const wireGain = ctx.createGain();
    wireGain.gain.setValueAtTime((soft ? 0.26 : 0.48) * vel, time);
    wireGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    wire.connect(wireBP); wireBP.connect(wireGain); wireGain.connect(destination);
    wire.start(time); wire.stop(time + dur + 0.02);
    rt.nodes.push(wire);

    if (rt.tier < 2) {
    // Bruit "crack" (attaque nette, au-delà de 6 kHz)
    const crack = ctx.createBufferSource();
    crack.buffer = rt.noise();
    const crackHP = ctx.createBiquadFilter();
    crackHP.type = 'highpass'; crackHP.frequency.value = 6000;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime((soft ? 0.1 : 0.3) * vel, time);
    crackGain.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.35);
    crack.connect(crackHP); crackHP.connect(crackGain); crackGain.connect(destination);
    crack.start(time); crack.stop(time + dur * 0.35 + 0.02);
    rt.nodes.push(crack);
    }

    // Corps : un seul sinus fondamental (pas de triangle, pour éviter le côté "buzz"
    // de synthé), avec une infime variation de hauteur à chaque coup pour ne pas
    // sonner deux fois exactement pareil.
    const bodyFreq = 180 * (0.985 + Math.random() * 0.03);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(bodyFreq, time);
    osc.frequency.exponentialRampToValueAtTime(bodyFreq * 0.86, time + dur);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime((soft ? 0.13 : 0.25) * vel, time);
    oGain.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.8);
    osc.connect(oGain); oGain.connect(destination);
    osc.start(time); osc.stop(time + dur * 0.8 + 0.02);
    rt.nodes.push(osc);

    if (rt.tier < 2) {
    // Deuxième résonance de la peau : un grain de bruit filtré (et non plus un
    // oscillateur accordé) — un vrai fût ne sonne jamais comme un "bip" pur.
    const shell = ctx.createBufferSource();
    shell.buffer = rt.noise();
    const shellBP = ctx.createBiquadFilter();
    shellBP.type = 'bandpass'; shellBP.frequency.value = 310; shellBP.Q.value = 2.4;
    const shellGain = ctx.createGain();
    shellGain.gain.setValueAtTime((soft ? 0.09 : 0.16) * vel, time);
    shellGain.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.45);
    shell.connect(shellBP); shellBP.connect(shellGain); shellGain.connect(destination);
    shell.start(time); shell.stop(time + dur * 0.45 + 0.02);
    rt.nodes.push(shell);
    }
}

// Banc d'oscillateurs carrés à fréquences non harmoniques (comme les circuits analogiques
// de cymbales) : donne un timbre métallique bien plus naturel qu'un simple bruit filtré.
function metalOscBank(rt, time, dur, freqs) {
    const ctx = rt.ctx;
    const bank = ctx.createGain();
    bank.gain.value = 1;
    freqs.forEach(f => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f;
        osc.connect(bank);
        osc.start(time); osc.stop(time + dur + 0.08);
        rt.nodes.push(osc);
    });
    return bank;
}

function synthHihat(rt, time, destination, open = false, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const dur = open ? 0.5 : 0.075;

    const bank = metalOscBank(rt, time, dur, rt.tier >= 2 ? [] : rt.tier === 1 ? [287, 415, 573] : [287, 343, 415, 479, 573, 637]);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = open ? 9000 : 10000; bp.Q.value = 0.6;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.002);
    if (open) {
        amp.gain.exponentialRampToValueAtTime(0.16 * vel, time + 0.09);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    bank.connect(hp); hp.connect(bp); bp.connect(amp); amp.connect(destination);

    // Un peu de bruit d'air pour adoucir le côté trop "pur" des oscillateurs
    const air = ctx.createBufferSource();
    air.buffer = rt.noise();
    const airHP = ctx.createBiquadFilter();
    airHP.type = 'highpass'; airHP.frequency.value = 9000;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime((rt.tier >= 2 ? 0.4 : 0.1) * vel, time);
    airGain.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.6);
    air.connect(airHP); airHP.connect(airGain); airGain.connect(destination);
    air.start(time); air.stop(time + dur * 0.6 + 0.02);
    rt.nodes.push(air);
}

function synthCymbal(rt, time, destination, dur = 1, vel = 1, hpFreq = 5500) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const reverb = rt.tier >= 1 ? null : rt.reverb();   // allégé : pas de seconde réverbération

    // Une seule source de bruit large bande, partagée par le corps du son et par
    // les résonances : plus de banc d'oscillateurs carrés (le côté "buzz" synthétique
    // et désagréable venait de là). Un vrai grondement de cymbale est avant tout du
    // bruit filtré, pas un son de synthétiseur.
    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();

    // Corps principal : bruit large bande qui s'assombrit lentement (perte naturelle
    // des aigus au fil de la résonance) et se pose avec une attaque douce et discrète.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = hpFreq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(10000, time);
    lp.frequency.exponentialRampToValueAtTime(Math.max(1500, hpFreq * 0.55), time + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0006, time);
    amp.gain.exponentialRampToValueAtTime(0.42 * vel, time + 0.025);
    amp.gain.exponentialRampToValueAtTime(0.14 * vel, time + 0.16);
    amp.gain.exponentialRampToValueAtTime(0.025 * vel, time + Math.max(0.25, dur * 0.6));
    amp.gain.exponentialRampToValueAtTime(0.0004, time + dur);
    noise.connect(hp); hp.connect(lp); lp.connect(amp); amp.connect(destination);
    if (reverb) {
        const send = ctx.createGain();
        send.gain.value = 0.6;
        amp.connect(send); send.connect(reverb);
    }

    // Quelques résonances métalliques étroites, tirées du même bruit filtré en bandes
    // (et non plus d'ondes carrées) : ça donne le "corps" et le chatoiement propres à
    // une cymbale sans le grain de synthétiseur. Les résonances aiguës s'éteignent
    // plus vite que les graves, comme sur un vrai métal.
    const resonances = [[300, 4, 0.16], [560, 5, 0.12], [900, 6, 0.085], [1500, 7, 0.055]];
    resonances.slice(0, rt.tier >= 2 ? 0 : rt.tier === 1 ? 2 : 4).forEach(([freq, q, level], idx) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
        const rGain = ctx.createGain();
        const decay = Math.max(0.2, dur * (0.85 - idx * 0.15));
        rGain.gain.setValueAtTime(0.0004, time);
        rGain.gain.exponentialRampToValueAtTime(level * vel, time + 0.015 + idx * 0.004);
        rGain.gain.exponentialRampToValueAtTime(0.0003, time + decay);
        noise.connect(bp); bp.connect(rGain); rGain.connect(destination);
        if (reverb) {
            const rSend = ctx.createGain();
            rSend.gain.value = 0.5;
            rGain.connect(rSend); rSend.connect(reverb);
        }
    });

    noise.start(time); noise.stop(time + dur + 0.05);
    rt.nodes.push(noise);
}

function synthCowbell(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    // Deux carrées non harmoniques (≈ 560 et 845 Hz) passées dans un passe-bande : le timbre creux et métallique de la cloche
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 760; bp.Q.value = 1.3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.24 * vel, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.065 * vel, time + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.22);
    [562, 845].forEach(f => {
        const o = ctx.createOscillator();
        o.type = 'square'; o.frequency.value = f;
        o.connect(bp);
        o.start(time); o.stop(time + 0.24);
        rt.nodes.push(o);
    });
    bp.connect(gain); gain.connect(destination);
}

function synthClave(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    // Bois dur : sinusoïde aiguë très brève (≈ 2,5 kHz) et un grain de bruit
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2550, time);
    osc.frequency.exponentialRampToValueAtTime(2300, time + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0006, time + 0.09);
    osc.connect(g); g.connect(destination);
    osc.start(time); osc.stop(time + 0.1);
    rt.nodes.push(osc);
}

function synthConga(rt, time, destination, freq = 300, dur = 0.3, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    // Peau : sinusoïde qui descend légèrement + claquement de la paume (bruit filtré très court)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.25, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.62 * vel, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    osc.connect(g); g.connect(destination);
    osc.start(time); osc.stop(time + dur + 0.02);
    rt.nodes.push(osc);

    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq * 4; bp.Q.value = 1.2;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.18 * vel, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
    noise.connect(bp); bp.connect(nGain); nGain.connect(destination);
    noise.start(time); noise.stop(time + 0.04);
    rt.nodes.push(noise);
}

function synthSlap(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    // Slap de conga : bruit large et sec sur le bord de la peau, avec un court corps aigu
    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0007, time + 0.09);
    noise.connect(bp); bp.connect(g); g.connect(destination);
    noise.start(time); noise.stop(time + 0.1);
    rt.nodes.push(noise);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, time);
    osc.frequency.exponentialRampToValueAtTime(380, time + 0.06);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.001, time);
    oGain.gain.exponentialRampToValueAtTime(0.24 * vel, time + 0.002);
    oGain.gain.exponentialRampToValueAtTime(0.0006, time + 0.07);
    osc.connect(oGain); oGain.connect(destination);
    osc.start(time); osc.stop(time + 0.08);
    rt.nodes.push(osc);
}

function synthShaker(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    // Maracas / shaker : bruit blanc aigu, attaque légèrement floue
    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0007, time + 0.07);
    noise.connect(hp); hp.connect(g); g.connect(destination);
    noise.start(time); noise.stop(time + 0.09);
    rt.nodes.push(noise);
}

function synthRim(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;

    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0006, time + 0.045);
    noise.connect(bp); bp.connect(lp); lp.connect(gain); gain.connect(destination);
    noise.start(time); noise.stop(time + 0.06);
    rt.nodes.push(noise);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, time);
    osc.frequency.exponentialRampToValueAtTime(410, time + 0.045);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.001, time);
    oGain.gain.exponentialRampToValueAtTime(0.26 * vel, time + 0.001);
    oGain.gain.exponentialRampToValueAtTime(0.0005, time + 0.045);
    osc.connect(oGain); oGain.connect(destination);
    osc.start(time); osc.stop(time + 0.06);
    rt.nodes.push(osc);
}

function synthTom(rt, time, destination, freq = 120, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;

    // Corps : chute de hauteur modeste et passe-bas serré pour un grain grave, mat,
    // plutôt qu'un timbre brillant qui "surgirait" au-dessus du reste de la batterie.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = freq * 3.8;
    const bodyFreq = freq * (0.99 + Math.random() * 0.02);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(bodyFreq * 1.3, time);
    osc.frequency.exponentialRampToValueAtTime(bodyFreq * 0.86, time + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.8 * vel, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.34);
    osc.connect(lp); lp.connect(gain); gain.connect(destination);
    osc.start(time); osc.stop(time + 0.36);
    rt.nodes.push(osc);

    // Deuxième résonance de la peau, sur l'attaque : un grain de bruit filtré
    // plutôt qu'un oscillateur accordé, qui sonnait comme un "bip" électronique
    // (surtout perceptible sur le tom le plus aigu).
    const overtone = ctx.createBufferSource();
    overtone.buffer = rt.noise();
    const obp = ctx.createBiquadFilter();
    obp.type = 'bandpass'; obp.frequency.value = freq * 1.6; obp.Q.value = 2.6;
    const oGain2 = ctx.createGain();
    oGain2.gain.setValueAtTime(0.09 * vel, time);
    oGain2.gain.exponentialRampToValueAtTime(0.0008, time + 0.06);
    overtone.connect(obp); obp.connect(oGain2); oGain2.connect(destination);
    overtone.start(time); overtone.stop(time + 0.07);
    rt.nodes.push(overtone);

    // Attaque : bruit bref et sourd de la baguette sur la peau, filtré plus bas
    // pour rester discret et ne pas ajouter de brillance.
    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq * 2; bp.Q.value = 0.9;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.1 * vel, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    noise.connect(bp); bp.connect(nGain); nGain.connect(destination);
    noise.start(time); noise.stop(time + 0.03);
    rt.nodes.push(noise);
}

// Grosse caisse de fanfare : coup sourd, hauteur qui tombe, un peu de peau.
function synthBassDrum(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.95 * vel, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(lp); lp.connect(g); g.connect(destination);
    osc.start(time); osc.stop(time + 0.65);
    rt.nodes.push(osc);
    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 170; bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.28 * vel, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.connect(bp); bp.connect(ng); ng.connect(destination);
    noise.start(time); noise.stop(time + 0.08);
    rt.nodes.push(noise);
}

// Timbale accordée : fondamentale, partiels (1,5 et 2 fois), coup de mailloche ; decay = durée de résonance (s).
function synthTimp(rt, time, destination, freq = 98, vel = 1, decay = 1.8) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    [[1, 0.8, 1], [1.5, 0.22, 0.55], [2, 0.12, 0.35]].forEach(([mul, amp, dk]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * mul * 1.06, time);
        osc.frequency.exponentialRampToValueAtTime(freq * mul, time + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, time);
        g.gain.exponentialRampToValueAtTime(amp * vel, time + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, time + decay * dk);
        osc.connect(g); g.connect(destination);
        osc.start(time); osc.stop(time + decay * dk + 0.05);
        rt.nodes.push(osc);
    });
    const noise = ctx.createBufferSource();
    noise.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq * 2.2; bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * vel, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(bp); bp.connect(ng); ng.connect(destination);
    noise.start(time); noise.stop(time + 0.07);
    rt.nodes.push(noise);
}

// Percussions des Balkans : tapan, baguette, darbuka (dum, tek, ka), daire.
function synthDarbuka(rt, time, destination, kind, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const tone = (type, f0, f1, tEnd, amp, dec) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, time);
        o.frequency.exponentialRampToValueAtTime(f1, time + tEnd);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, time);
        g.gain.exponentialRampToValueAtTime(amp * vel, time + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0007, time + dec);
        o.connect(g); g.connect(destination);
        o.start(time); o.stop(time + dec + 0.03);
        rt.nodes.push(o);
    };
    const noise = (type, freq, q, amp, dec, delay = 0) => {
        const s = ctx.createBufferSource();
        s.buffer = rt.noise();
        const fl = ctx.createBiquadFilter();
        fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
        const g = ctx.createGain();
        const t0 = time + delay;
        g.gain.setValueAtTime(0.001, t0);
        g.gain.exponentialRampToValueAtTime(amp * vel, t0 + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0007, t0 + dec);
        s.connect(fl); fl.connect(g); g.connect(destination);
        s.start(t0); s.stop(t0 + dec + 0.02);
        rt.nodes.push(s);
    };
    switch (kind) {
        case 'dum':     // centre de la peau : grave, rond
            tone('sine', 200, 108, 0.09, 0.85, 0.3);
            noise('bandpass', 420, 0.9, 0.16, 0.05);
            break;
        case 'tek':     // bord de la peau : sec et brillant
            tone('triangle', 920, 640, 0.04, 0.2, 0.07);
            noise('bandpass', 3300, 1.8, 0.42, 0.06);
            break;
        case 'ka':      // doigts sur le bord : léger, mat
            tone('triangle', 640, 520, 0.03, 0.1, 0.05);
            noise('bandpass', 2300, 1.2, 0.25, 0.05);
            break;
        case 'tapan':   // grosse caisse à deux peaux, frappée à la mailloche
            tone('sine', 128, 66, 0.12, 0.95, 0.38);
            noise('lowpass', 520, 0.7, 0.2, 0.07);
            noise('bandpass', 1200, 0.8, 0.1, 0.02);
            break;
        case 'stick':   // baguette fine sur la peau du tapan
            tone('triangle', 1100, 780, 0.035, 0.14, 0.05);
            noise('bandpass', 2700, 2.5, 0.38, 0.04);
            break;
        case 'daire':   // cymbalettes du tambour sur cadre
            noise('highpass', 5800, 0.7, 0.2, 0.08);
            noise('highpass', 6400, 0.7, 0.14, 0.07, 0.018);
            break;
    }
}

// Golpe : coup de la main sur la caisse du violon ou du bandonéon (sec, boisé).
function synthGolpe(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, time);
    o.frequency.exponentialRampToValueAtTime(95, time + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.7 * vel, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0007, time + 0.16);
    o.connect(g); g.connect(destination);
    o.start(time); o.stop(time + 0.18);
    const s = ctx.createBufferSource();
    s.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.1;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.001, time);
    gn.gain.exponentialRampToValueAtTime(0.32 * vel, time + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0007, time + 0.04);
    s.connect(bp); bp.connect(gn); gn.connect(destination);
    s.start(time); s.stop(time + 0.05);
    rt.nodes.push(o, s);
}

// Chicharra : grattement de l'archet (ou des doigts sur les cordes), bruit modulé qui descend en fréquence.
function synthChicharra(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const s = ctx.createBufferSource();
    s.buffer = rt.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(5200, time);
    bp.frequency.exponentialRampToValueAtTime(2400, time + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0007, time + 0.2);
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = ctx.createGain();
    lg.gain.value = 0.4;
    lfo.connect(lg); lg.connect(am.gain);
    s.connect(bp); bp.connect(am); am.connect(g); g.connect(destination);
    s.start(time); s.stop(time + 0.22);
    lfo.start(time); lfo.stop(time + 0.22);
    rt.nodes.push(s, lfo);
}

// Látigo : coup de fouet (craquement bref, plus un « zap » qui chute).
function synthLatigo(rt, time, destination, vel = 1) {
    const ctx = rt.ctx;
    if (!ctx || !destination) return;
    const s = ctx.createBufferSource();
    s.buffer = rt.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2800; hp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.exponentialRampToValueAtTime(0.6 * vel, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0007, time + 0.11);
    s.connect(hp); hp.connect(g); g.connect(destination);
    s.start(time); s.stop(time + 0.12);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(2400, time);
    o.frequency.exponentialRampToValueAtTime(300, time + 0.12);
    const go = ctx.createGain();
    go.gain.setValueAtTime(0.001, time);
    go.gain.exponentialRampToValueAtTime(0.22 * vel, time + 0.003);
    go.gain.exponentialRampToValueAtTime(0.0007, time + 0.15);
    o.connect(go); go.connect(destination);
    o.start(time); o.stop(time + 0.17);
    rt.nodes.push(s, o);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { makeNoiseBuffer, makeSaturationCurve, drumSpec, synthDrumLive, synthKick, synthSnare, metalOscBank, synthHihat,
        synthCymbal, synthCowbell, synthClave, synthConga, synthSlap, synthShaker, synthRim, synthTom, synthBassDrum, synthTimp,
        synthDarbuka, synthGolpe, synthChicharra, synthLatigo };
}
