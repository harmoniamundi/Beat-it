// offline.js — mode hors ligne : enregistre le service worker (sw.js, à la racine), lui demande de télécharger les
// sons en arrière-plan et affiche une petite pastille d'état tant que ce n'est pas fini. Chargé par index.html
// en dernier. Testé par offline.test.js (la partie sans navigateur : le texte de la pastille).

// Texte de la pastille selon l'avancement envoyé par le service worker ; '' = ne rien afficher.
//   progress : { type: 'sounds-progress', done, total }   téléchargement en cours
//   done     : { type: 'sounds-done', done, total, failed, downloaded }
function offlineChipText(msg) {
    if (!msg || typeof msg !== 'object') return '';
    if (msg.type === 'sounds-progress') return 'Sons hors ligne : ' + (msg.done | 0) + '/' + (msg.total | 0);
    if (msg.type === 'sounds-done') {
        if (msg.failed > 0) return 'Sons hors ligne incomplets (' + msg.done + '/' + msg.total + ') — rouvrir l’appli avec du réseau';
        // Déjà tout en mémoire depuis une visite précédente : inutile de le rappeler à chaque ouverture.
        return msg.downloaded > 0 ? '✓ Prêt hors ligne' : '';
    }
    return '';
}

function setupOffline() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

    let chip = null, hideTimer = null;
    function showChip(text, autoHideMs) {
        clearTimeout(hideTimer);
        if (!text) { if (chip) chip.hidden = true; return; }
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'offline-chip';
            chip.setAttribute('role', 'status');
            chip.setAttribute('aria-live', 'polite');
            document.body.appendChild(chip);
        }
        chip.textContent = text;
        chip.hidden = false;
        if (autoHideMs) hideTimer = setTimeout(() => { chip.hidden = true; }, autoHideMs);
    }

    navigator.serviceWorker.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || (msg.type !== 'sounds-progress' && msg.type !== 'sounds-done')) return;
        showChip(offlineChipText(msg), msg.type === 'sounds-done' ? 6000 : 0);
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
            // On laisse d'abord l'appli charger le piano dont elle a besoin tout de suite, puis on complète le reste.
            if (navigator.onLine !== false) setTimeout(() => { if (reg.active) reg.active.postMessage({ type: 'precache-sounds' }); }, 4000);
        }).catch(() => { /* hors ligne ou navigateur sans service worker : l'appli marche comme avant */ });
    });
}

setupOffline();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { offlineChipText, setupOffline };
}
