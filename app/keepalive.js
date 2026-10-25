// keepalive.js — comportements propres au téléphone :
//  1. le son est joué même quand l'iPhone est en mode silencieux (interrupteur latéral) ;
//  2. l'écran reste allumé (pas de mise en veille automatique) tant que l'appli est affichée.
// Tout est protégé : sur un navigateur qui ne connaît pas ces fonctions, il ne se passe simplement rien.
// Chargé par index.html avant audio-engine.js.
const Keepalive = (() => {
    const gestures = ['pointerdown', 'touchend', 'click', 'keydown'];

    // ---------- 1. Son malgré le mode silencieux ----------
    // iOS 16.4+ : on déclare que la page « lit un média » (comme un lecteur de musique) → le Web Audio ignore l'interrupteur.
    // Plus ancien : la même astuce passe par une balise <audio> muette qui boucle (iOS range alors la page dans « média »).
    let silentEl = null;
    function silentWavUrl() {
        const rate = 8000, n = rate; // 1 s de silence, 8 bits mono
        const buf = new Uint8Array(44 + n);
        const dv = new DataView(buf.buffer);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
        str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
        dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
        str(36, 'data'); dv.setUint32(40, n, true);
        buf.fill(128, 44); // 128 = silence en 8 bits
        return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }
    // À appeler avant de créer l'AudioContext.
    function setupAudioSession() {
        try {
            if (typeof navigator !== 'undefined' && 'audioSession' in navigator) navigator.audioSession.type = 'playback';
        } catch (e) { /* ignoré */ }
    }
    // À appeler dans un geste de l'utilisateur (le premier toucher).
    const isIOS = () => typeof navigator !== 'undefined' &&
        (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    function startSilentAudio() {
        if (!isIOS() || 'audioSession' in navigator) return; // seulement sur iPhone/iPad ancien : ailleurs, inutile
        try {
            if (!silentEl) {
                silentEl = document.createElement('audio');
                silentEl.src = silentWavUrl();
                silentEl.loop = true;
                silentEl.setAttribute('playsinline', '');
                silentEl.setAttribute('aria-hidden', 'true');
                silentEl.volume = 0.01;
                silentEl.style.display = 'none';
                document.body.appendChild(silentEl);
            }
            const p = silentEl.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignoré */ }
    }

    // ---------- 2. Écran toujours allumé ----------
    let lock = null, pending = false, video = null, wanted = true;
    // Mini-vidéo muette (noire, 2 s) pour les iPhone sans l'API « Wake Lock » : tant qu'une vidéo joue, iOS ne met pas l'écran en veille.
    const VIDEO_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMybW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlx0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHUbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABf21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAT9zdGJsAAAAt3N0c2QAAAAAAAAAAQAAAKdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALWF2Y0MBQsAe/+EAFmdCwB7aJbARAAADAAEAAAMABA8WLqABAARozg/IAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAACogAAAqIAAAAGHN0dHMAAAAAAAAAAQAAAAQAACAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAQAAAABAAAAJHN0c3oAAAAAAAAAAAAAAAQAAAKEAAAACgAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA2IAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAACqm1kYXQAAAJsBgX//2jcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT0yIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0wIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PTAgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTQga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAQZYiEBT///w9FAAE9/yddeAAAAAZBmiAU8sAAAAAGQZpAFPLAAAAABkGaYBLywA==';
    function requestWakeLock() {
        if (!wanted || document.visibilityState !== 'visible') return;
        if (typeof navigator !== 'undefined' && navigator.wakeLock && navigator.wakeLock.request) {
            if (lock || pending) return;
            pending = true;
            navigator.wakeLock.request('screen').then((l) => {
                pending = false;
                lock = l;
                l.addEventListener('release', () => { if (lock === l) lock = null; });
                if (!wanted) { try { l.release(); } catch (e) { /* ignoré */ } }
            }).catch(() => { pending = false; /* refusé (économie d'énergie…) : on réessaiera au prochain toucher */ });
            return;
        }
        try { // repli
            if (!video) {
                video = document.createElement('video');
                video.src = VIDEO_MP4;
                video.muted = true; video.loop = true;
                video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-hidden', 'true');
                video.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;';
                document.body.appendChild(video);
            }
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignoré */ }
    }
    function releaseWakeLock() {
        wanted = false;
        try { if (lock) lock.release(); } catch (e) { /* ignoré */ }
        lock = null;
        try { if (video) video.pause(); } catch (e) { /* ignoré */ }
    }
    // Permet de rendre l'écran à l'iPhone (non utilisé par défaut : l'écran reste allumé tant que l'appli est affichée).
    function keepScreenOn(on) { if (on) { wanted = true; requestWakeLock(); } else releaseWakeLock(); }

    // ---------- Branchement ----------
    let resumeCb = null;
    function onGesture() {
        startSilentAudio();
        requestWakeLock();
        if (resumeCb) resumeCb();
    }
    function onVisible() {
        if (document.visibilityState !== 'visible') return;
        // le navigateur libère le verrou quand la page passe en arrière-plan (évènement « release ») : on le redemande ici
        requestWakeLock();
        if (video && wanted) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
        if (silentEl) { const p = silentEl.play(); if (p && p.catch) p.catch(() => {}); }
        if (resumeCb) resumeCb();
    }
    // resume : fonction qui relance le moteur audio s'il a été suspendu (appel entrant, retour d'une autre appli…).
    function install(resume) {
        resumeCb = resume || null;
        if (typeof document === 'undefined') return;
        gestures.forEach((evt) => document.addEventListener(evt, onGesture, { passive: true }));
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', (e) => { if (e.persisted) onVisible(); });
        requestWakeLock(); // si le navigateur l'autorise sans geste
    }

    return { install, setupAudioSession, startSilentAudio, keepScreenOn, requestWakeLock };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Keepalive };
