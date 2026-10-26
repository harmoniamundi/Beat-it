// projects.js — fenêtre « Projets » du Séquenceur pas à pas : enregistrer plusieurs projets dans le navigateur,
// les rouvrir, les renommer, les supprimer, et les exporter / importer en fichier .json.
// (Annuler / refaire et la sauvegarde automatique sont dans sequencer.js.)
//
// Un projet enregistré : { id, name, saved (date ISO), data (l'état complet de l'appli) }.
// Un fichier exporté : { app: 'sequenceur-pas-a-pas', format: 1, name, saved, data }
//   ou, pour « Exporter tous les projets » : { app, format, projects: [ { name, saved, data }, … ] }.

const Projects = (() => {
    'use strict';

    const STORE = 'sequenceur-pas-a-pas-projets-v1';       // la liste des projets enregistrés
    const NAME_KEY = 'sequenceur-pas-a-pas-nom-v1';        // dernier nom utilisé (pour préremplir le champ)
    const APP = 'sequenceur-pas-a-pas';
    let deps = null, root = null, nameEl, listEl, msgEl, exportAllBtn, fileEl, opener = null;

    const h = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    };
    const btn = (label, cls, fn, title) => {
        const b = h('button', cls || 'btn-sm', label);
        b.type = 'button';
        if (title) b.title = title;
        b.addEventListener('click', fn);
        return b;
    };

    /* ---------- Stockage ---------- */
    function readList() {
        try {
            const a = JSON.parse(localStorage.getItem(STORE));
            if (Array.isArray(a)) return a.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.data && typeof p.data === 'object');
        } catch (e) { /* pas encore de liste, ou illisible */ }
        return [];
    }
    function writeList(list) {
        try {
            localStorage.setItem(STORE, JSON.stringify(list));
            return true;
        } catch (e) {
            say('Impossible d’enregistrer : l’espace du navigateur est plein ou indisponible. Exportez vos projets en fichier, puis supprimez-en.', true);
            return false;
        }
    }
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const lastName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
    function rememberName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignoré */ } }

    // Nom libre : si « Rock » existe déjà, « Rock (2) »
    function freeName(name, list) {
        const taken = new Set(list.map(p => p.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        let n = 2;
        while (taken.has((name + ' (' + n + ')').toLowerCase())) n++;
        return name + ' (' + n + ')';
    }

    /* ---------- Affichage ---------- */
    function say(text, bad) {
        if (!msgEl) return;
        msgEl.textContent = text || '';
        msgEl.classList.toggle('bad', !!bad);
    }
    const fmtDate = iso => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    };

    function renderList() {
        const list = readList().sort((a, b) => String(b.saved).localeCompare(String(a.saved)));
        listEl.textContent = '';
        exportAllBtn.disabled = !list.length;
        if (!list.length) {
            listEl.append(h('p', 'hint', 'Aucun projet enregistré pour l’instant.'));
            return;
        }
        list.forEach(p => {
            const row = h('li', 'proj-item');
            const info = h('div', 'proj-info');
            info.append(h('strong', null, p.name), h('span', 'hint', [deps.summary(p.data), fmtDate(p.saved)].filter(Boolean).join(' · ')));
            const acts = h('div', 'proj-acts');
            acts.append(
                btn('Ouvrir', 'btn-sm btn-gen', () => openProject(p.id), 'Remplace le projet en cours (on peut revenir avec « Annuler »)'),
                btn('Renommer', 'btn-sm', () => renameProject(p.id)),
                btn('Supprimer', 'btn-sm btn-del', () => deleteProject(p.id))
            );
            row.append(info, acts);
            listEl.append(row);
        });
    }

    /* ---------- Actions ---------- */
    function saveCurrent() {
        const name = nameEl.value.trim();
        if (!name) { say('Donnez un nom au projet.', true); nameEl.focus(); return; }
        const list = readList(), same = list.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (same && !window.confirm('Un projet « ' + same.name + ' » existe déjà. Le remplacer ?')) return;
        const entry = { id: same ? same.id : newId(), name: same ? same.name : name, saved: new Date().toISOString(), data: deps.getData() };
        if (!writeList(same ? list.map(p => p === same ? entry : p) : list.concat(entry))) return;
        rememberName(entry.name);
        nameEl.value = entry.name;
        say('« ' + entry.name + ' » enregistré.');
        renderList();
    }
    function openProject(id) {
        const p = readList().find(q => q.id === id);
        if (!p) return;
        if (!deps.open(p.data)) { say('Ce projet est illisible.', true); return; }
        rememberName(p.name);
        nameEl.value = p.name;
        close(true);
    }
    function renameProject(id) {
        const list = readList(), p = list.find(q => q.id === id);
        if (!p) return;
        const name = (window.prompt('Nouveau nom du projet :', p.name) || '').trim();
        if (!name || name === p.name) return;
        if (list.some(q => q !== p && q.name.toLowerCase() === name.toLowerCase())) { say('Un projet porte déjà ce nom.', true); return; }
        p.name = name;
        if (writeList(list)) { say('Renommé en « ' + name + ' ».'); renderList(); }
    }
    function deleteProject(id) {
        const list = readList(), p = list.find(q => q.id === id);
        if (!p || !window.confirm('Supprimer le projet « ' + p.name + ' » ? Cela ne peut pas s’annuler.')) return;
        if (writeList(list.filter(q => q !== p))) { say('« ' + p.name + ' » supprimé.'); renderList(); }
    }
    function newProject() {
        if (!deps.blank()) return;
        nameEl.value = '';
        rememberName('');
        close(true);
    }

    /* ---------- Fichiers ---------- */
    const slug = n => (n || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'projet';
    function download(filename, obj) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
        const a = h('a');
        a.href = url;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    function exportCurrent() {
        const name = nameEl.value.trim() || 'Sans titre';
        download(slug(name) + '.sequenceur.json', { app: APP, format: 1, name, saved: new Date().toISOString(), data: deps.getData() });
        say('Fichier « ' + slug(name) + '.sequenceur.json » exporté.');
    }
    function exportAll() {
        const list = readList();
        if (!list.length) return;
        download('sequenceur-projets.json', { app: APP, format: 1, projects: list.map(p => ({ name: p.name, saved: p.saved, data: p.data })) });
        say(list.length + ' projet' + (list.length > 1 ? 's' : '') + ' exporté' + (list.length > 1 ? 's' : '') + '.');
    }

    // Lit un fichier choisi : un projet (il remplace le projet en cours, on peut l'annuler) ou une sauvegarde de plusieurs projets
    // (ils s'ajoutent à la liste). Renvoie un petit compte rendu.
    async function readFile(file) {
        let obj;
        try { obj = JSON.parse(await file.text()); } catch (e) { return { bad: file.name + ' : ce n’est pas un fichier de projet (JSON illisible).' }; }
        if (!obj || typeof obj !== 'object') return { bad: file.name + ' : fichier vide ou inattendu.' };
        if (Array.isArray(obj.projects)) {
            const ok = obj.projects.filter(p => p && p.data && typeof p.data === 'object');
            if (obj.app !== APP || !ok.length) return { bad: file.name + ' : aucun projet du séquenceur dans ce fichier.' };
            const list = readList();
            ok.forEach(p => list.push({ id: newId(), name: freeName(String(p.name || 'Sans titre').slice(0, 80), list), saved: p.saved || new Date().toISOString(), data: p.data }));
            return writeList(list) ? { added: ok.length } : { bad: 'Enregistrement impossible.' };
        }
        // Un projet : { app, data } ; on accepte aussi l'état brut (ancienne sauvegarde copiée à la main)
        const data = obj.app === APP && obj.data && typeof obj.data === 'object' ? obj.data : ((obj.pat && typeof obj.pat === 'object') || Array.isArray(obj.pats) ? obj : null);
        if (!data) return { bad: file.name + ' : ce fichier n’est pas un projet du séquenceur.' };
        if (!deps.open(data)) return { bad: file.name + ' : projet illisible.' };
        return { opened: String(obj.name || file.name.replace(/\.json$/i, '').replace(/\.sequenceur$/i, '')).slice(0, 80) };
    }
    async function importFiles(files) {
        const notes = [];
        let bad = false, opened = '';
        for (const f of files) {
            const r = await readFile(f);
            if (r.bad) { notes.push(r.bad); bad = true; }
            else if (r.added) notes.push(r.added + ' projet' + (r.added > 1 ? 's' : '') + ' ajouté' + (r.added > 1 ? 's' : '') + ' à la liste.');
            else if (r.opened) { opened = r.opened; notes.push('« ' + r.opened + ' » importé.'); }
        }
        fileEl.value = '';
        renderList();
        if (opened && !bad) {
            nameEl.value = opened;
            rememberName(opened);
            close(true);
        } else {
            say(notes.join(' '), bad);
        }
    }

    /* ---------- Fenêtre ---------- */
    function build() {
        root = h('div', 'proj-back');
        root.hidden = true;
        const box = h('section', 'proj');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'projTitle');

        const head = h('div', 'insp-head');
        const title = h('strong', null, 'Projets');
        title.id = 'projTitle';
        const x = h('button', 'insp-x', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', 'Fermer');
        x.addEventListener('click', () => close());
        head.append(title, x);

        const save = h('div', 'fx');
        save.append(h('span', 'lbl', 'Enregistrer le projet en cours'));
        const line = h('div', 'proj-line');
        nameEl = h('input', 'txt');
        nameEl.type = 'text';
        nameEl.maxLength = 80;
        nameEl.placeholder = 'Nom du projet';
        nameEl.setAttribute('aria-label', 'Nom du projet');
        nameEl.autocomplete = 'off';
        nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') saveCurrent(); });
        line.append(nameEl, btn('Enregistrer', 'btn-sm btn-gen', saveCurrent));
        save.append(line);
        msgEl = h('p', 'proj-msg');
        msgEl.setAttribute('role', 'status');
        save.append(msgEl);

        const saved = h('div', 'fx');
        saved.append(h('span', 'lbl', 'Enregistrés dans ce navigateur'));
        listEl = h('ul', 'proj-list');
        saved.append(listEl);

        const files = h('div', 'fx');
        files.append(h('span', 'lbl', 'Fichiers'));
        const fl = h('div', 'proj-files');
        fileEl = h('input');
        fileEl.type = 'file';
        fileEl.accept = '.json,application/json';
        fileEl.multiple = true;
        fileEl.hidden = true;
        fileEl.addEventListener('change', () => { if (fileEl.files.length) importFiles(Array.from(fileEl.files)); });
        exportAllBtn = btn('Exporter tous les projets', 'btn-sm', exportAll, 'Une seule sauvegarde de tous les projets enregistrés ici');
        fl.append(
            btn('Exporter ce projet', 'btn-sm', exportCurrent, 'Fichier .json à garder, envoyer ou ouvrir sur un autre appareil'),
            btn('Importer un fichier…', 'btn-sm', () => fileEl.click(), 'Remplace le projet en cours (on peut revenir avec « Annuler »)'),
            exportAllBtn, fileEl
        );
        files.append(fl);

        const more = h('div', 'fx');
        more.append(btn('Nouveau projet', 'btn-sm', newProject, 'Grilles vides ; vos sons sont conservés. On peut revenir avec « Annuler ».'));
        more.append(h('p', 'hint', 'Le projet en cours est aussi gardé automatiquement : il se retrouve au prochain lancement. Les projets enregistrés servent à en garder plusieurs.'));

        box.append(head, save, saved, files, more);
        root.append(box);
        root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
        root.addEventListener('keydown', e => {
            e.stopPropagation();                      // la barre d'espace ne lance pas la lecture ici
            if (e.key === 'Escape') close();
        });
        document.body.append(root);
    }

    function open() {
        if (!root) build();
        opener = document.activeElement;
        say('');
        nameEl.value = lastName();
        renderList();
        root.hidden = false;
        document.body.classList.add('proj-open');
        root.querySelector('.insp-x').focus();
    }
    function close(done) {
        if (!root || root.hidden) return;
        root.hidden = true;
        document.body.classList.remove('proj-open');
        if (opener && opener.focus && !done) opener.focus();
        opener = null;
    }
    const isOpen = () => !!root && !root.hidden;
    function init(d) { deps = d; }

    return { init, open, close, isOpen };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Projects;
