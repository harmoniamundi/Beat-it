// theory.js — gammes, noms de notes et lignes de la grille mélodique du Séquenceur pas à pas.
// Sans dépendance ni accès au DOM. Testé par theory.test.js (node app/theory.test.js).
//
// Règle d'écriture : la gamme de référence est toujours la gamme majeure. Chaque note d'une gamme est décrite par
// son degré (« 1 », « b3 », « #4 »…) ; la lettre de la note est celle du degré (la 3e d'une gamme de Si♭ s'écrit
// avec un D, la 7e avec un A), l'altération s'ajuste ensuite. Ainsi Si♭ majeur s'écrit Si♭ Do Ré Mi♭ Fa Sol La,
// et pas Si♭ Do Ré Ré♯ Fa Sol La.

const Theory = (() => {
    const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

    // Fondamentales proposées : les deux écritures des touches noires (dièse et bémol).
    const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

    // Les gammes et modes de Mode Machine (mêmes noms, mêmes groupes, mêmes notes), plus la gamme chromatique.
    // `tokens` : le degré de chaque note par rapport à la gamme majeure (« b3 » = tierce mineure). Les gammes qui n'ont pas
    // 7 notes sont écrites avec les mêmes lettres que dans Mode Machine (ex. blues : Do Mi♭ Fa Fa♯ Sol Si♭).
    const SCALES = [
        // Diatoniques
        { id: 'major', group: 'Diatoniques', name: 'Majeure (Ionien)', tokens: ['1', '2', '3', '4', '5', '6', '7'] },
        { id: 'dorian', group: 'Diatoniques', name: 'Dorien', tokens: ['1', '2', 'b3', '4', '5', '6', 'b7'] },
        { id: 'phrygian', group: 'Diatoniques', name: 'Phrygien', tokens: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'lydian', group: 'Diatoniques', name: 'Lydien', tokens: ['1', '2', '3', '#4', '5', '6', '7'] },
        { id: 'mixolydian', group: 'Diatoniques', name: 'Mixolydien', tokens: ['1', '2', '3', '4', '5', '6', 'b7'] },
        { id: 'minor', group: 'Diatoniques', name: 'Mineure naturelle (Éolien)', tokens: ['1', '2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'locrian', group: 'Diatoniques', name: 'Locrien', tokens: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'] },
        // Mineure Mélodique
        { id: 'melodicMinor', group: 'Mineure Mélodique', name: 'Mineure mélodique', tokens: ['1', '2', 'b3', '4', '5', '6', '7'] },
        { id: 'dorian_b2', group: 'Mineure Mélodique', name: 'Dorien b2', tokens: ['1', 'b2', 'b3', '4', '5', '6', 'b7'] },
        { id: 'lydian_augmented', group: 'Mineure Mélodique', name: 'Lydien augmenté', tokens: ['1', '2', '3', '#4', '#5', '6', '7'] },
        { id: 'lydian_dominant', group: 'Mineure Mélodique', name: 'Lydien dominant', tokens: ['1', '2', '3', '#4', '5', '6', 'b7'] },
        { id: 'mixolydian_b6', group: 'Mineure Mélodique', name: 'Mixolydien b6', tokens: ['1', '2', '3', '4', '5', 'b6', 'b7'] },
        { id: 'locrian_sharp2', group: 'Mineure Mélodique', name: 'Locrien #2', tokens: ['1', '2', 'b3', '4', 'b5', 'b6', 'b7'] },
        { id: 'altered', group: 'Mineure Mélodique', name: 'Altérée', tokens: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] },
        // Mineure Harmonique & Hongroises
        { id: 'harmonicMinor', group: 'Mineure Harmonique & Hongroises', name: 'Mineure harmonique', tokens: ['1', '2', 'b3', '4', '5', 'b6', '7'] },
        { id: 'hungarian_minor', group: 'Mineure Harmonique & Hongroises', name: 'Hongroise mineure (Tzigane)', tokens: ['1', '2', 'b3', '#4', '5', 'b6', '7'] },
        { id: 'hungarian_major', group: 'Mineure Harmonique & Hongroises', name: 'Hongroise majeure', tokens: ['1', '#2', '3', '#4', '5', '6', 'b7'] },
        { id: 'locrian_6', group: 'Mineure Harmonique & Hongroises', name: 'Locrien 6', tokens: ['1', 'b2', 'b3', '4', 'b5', '6', 'b7'] },
        { id: 'ionian_sharp5', group: 'Mineure Harmonique & Hongroises', name: 'Ionien augmenté', tokens: ['1', '2', '3', '4', '#5', '6', '7'] },
        { id: 'dorian_sharp4', group: 'Mineure Harmonique & Hongroises', name: 'Dorien #4', tokens: ['1', '2', 'b3', '#4', '5', '6', 'b7'] },
        { id: 'phryg_dom', group: 'Mineure Harmonique & Hongroises', name: 'Phrygien dominant', tokens: ['1', 'b2', '3', '4', '5', 'b6', 'b7'] },
        { id: 'lydian_sharp2', group: 'Mineure Harmonique & Hongroises', name: 'Lydien #2', tokens: ['1', '#2', '3', '#4', '5', '6', '7'] },
        { id: 'super_locrien_bb7', group: 'Mineure Harmonique & Hongroises', name: 'Ultra locrien', tokens: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'bb7'] },
        // Exotiques & Spéciales
        { id: 'neapolitan_major', group: 'Exotiques & Spéciales', name: 'Napolitaine majeure', tokens: ['1', 'b2', 'b3', '4', '5', '6', '7'] },
        { id: 'neapolitan_minor', group: 'Exotiques & Spéciales', name: 'Napolitaine mineure', tokens: ['1', 'b2', 'b3', '4', '5', 'b6', '7'] },
        { id: 'enigmatic', group: 'Exotiques & Spéciales', name: 'Énigmatique', tokens: ['1', 'b2', '3', '#4', '#5', '#6', '7'] },
        { id: 'prometheus', group: 'Exotiques & Spéciales', name: 'Prométhée', tokens: ['1', '2', '3', '#4', '6', 'b7'] },
        { id: 'persian', group: 'Exotiques & Spéciales', name: 'Persane', tokens: ['1', 'b2', '3', '4', 'b5', 'b6', '7'] },
        { id: 'byzantine', group: 'Exotiques & Spéciales', name: 'Byzantine / Double harmonique', tokens: ['1', 'b2', '3', '4', '5', 'b6', '7'] },
        { id: 'chinese', group: 'Exotiques & Spéciales', name: 'Chinoise', tokens: ['1', '3', '#4', '5', '7'] },
        { id: 'chinese_pentatonic', group: 'Exotiques & Spéciales', name: 'Chinoise pentatonique', tokens: ['1', '2', '3', '5', '6'] },
        { id: 'chinese_lu_lu', group: 'Exotiques & Spéciales', name: 'Chinoise Lü-Lü', tokens: ['1', '2', '3', '4', '5', '6', '7'] },
        // Pentatoniques & Blues
        { id: 'pentMaj', group: 'Pentatoniques & Blues', name: 'Pentatonique majeure', tokens: ['1', '2', '3', '5', '6'] },
        { id: 'pentMin', group: 'Pentatoniques & Blues', name: 'Pentatonique mineure', tokens: ['1', 'b3', '4', '5', 'b7'] },
        { id: 'blues', group: 'Pentatoniques & Blues', name: 'Blues mineure', tokens: ['1', 'b3', '4', '#4', '5', 'b7'] },
        { id: 'blues_major', group: 'Pentatoniques & Blues', name: 'Blues majeure', tokens: ['1', '2', 'b3', '3', '5', '6'] },
        { id: 'hirajoshi', group: 'Pentatoniques & Blues', name: 'Hirajōshi (Japonaise)', tokens: ['1', '2', 'b3', '5', 'b6'] },
        { id: 'insen', group: 'Pentatoniques & Blues', name: 'Insen (Japonaise)', tokens: ['1', 'b2', '4', '5', 'b7'] },
        { id: 'iwato', group: 'Pentatoniques & Blues', name: 'Iwato (Japonaise)', tokens: ['1', 'b2', '4', 'b5', 'b7'] },
        { id: 'yo', group: 'Pentatoniques & Blues', name: 'Yō (Japonaise)', tokens: ['1', '2', '4', '5', '6'] },
        // Symétriques & Autres
        { id: 'chromatic', group: 'Symétriques & Autres', name: 'Chromatique', tokens: ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'] },
        { id: 'wholeTone', group: 'Symétriques & Autres', name: 'Par tons', tokens: ['1', '2', '3', '#4', '#5', 'b7'] },
        { id: 'diminished_hw', group: 'Symétriques & Autres', name: 'Diminuée (1-2)', tokens: ['1', 'b2', 'b3', '3', '#4', '5', '6', 'b7'] },
        { id: 'diminished_wh', group: 'Symétriques & Autres', name: 'Diminuée (2-1)', tokens: ['1', '2', 'b3', '4', 'b5', 'b6', '6', '7'] },
        { id: 'augmented', group: 'Symétriques & Autres', name: 'Augmentée', tokens: ['1', '#2', '3', '5', '#5', '7'] },
        // Les Maqâmat
        { id: 'maqam_rast', group: 'Les Maqâmat', name: 'Maqâm Rast / Majeure', tokens: ['1', '2', 'b3', '4', '5', '6', 'b7'] },
        { id: 'maqam_bayati', group: 'Les Maqâmat', name: 'Maqâm Bayati / Dastgâh Shur', tokens: ['1', '2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'maqam_hijaz', group: 'Les Maqâmat', name: 'Maqâm Hijaz / Dastgâh Homayoun', tokens: ['1', 'b2', '3', '4', '5', 'b6', 'b7'] },
        { id: 'maqam_nahawand', group: 'Les Maqâmat', name: 'Maqâm Nahawand / Mineure naturelle', tokens: ['1', '2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'maqam_kurd', group: 'Les Maqâmat', name: 'Maqâm Kurd / Phrygien', tokens: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'] },
        // Gammes indiennes
        { id: 'raga_bilawal', group: 'Gammes indiennes', name: 'Râga Bilawal', tokens: ['1', '2', '3', '4', '5', '6', '7'] },
        { id: 'raga_kalyan', group: 'Gammes indiennes', name: 'Râga Kalyan', tokens: ['1', '2', '3', '#4', '5', '6', '7'] },
        { id: 'raga_bhairav', group: 'Gammes indiennes', name: 'Râga Bhairav', tokens: ['1', 'b2', '3', '4', '5', 'b6', '7'] },
        { id: 'raga_todi', group: 'Gammes indiennes', name: 'Râga Todi', tokens: ['1', 'b2', 'b3', '#4', '5', 'b6', '7'] },
        { id: 'raga_asavari', group: 'Gammes indiennes', name: 'Râga Asavari', tokens: ['1', '2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'raga_yaman', group: 'Gammes indiennes', name: 'Râga Yaman', tokens: ['1', '2', '3', '#4', '5', '6', '7'] },
        { id: 'raga_Bhairavi', group: 'Gammes indiennes', name: 'Râga Bhairavi', tokens: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'raga_shankarabharana', group: 'Gammes indiennes', name: 'Râga Shankarabharana', tokens: ['1', '2', '3', '4', '5', '6', '7'] },
        { id: 'raga_kharaharapriya', group: 'Gammes indiennes', name: 'Râga Kharaharapriya', tokens: ['1', '2', 'b3', '4', '5', '6', 'b7'] },
        { id: 'raga_hanumatodi', group: 'Gammes indiennes', name: 'Râga Hanumatodi', tokens: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'raga_mayamalavagowula', group: 'Gammes indiennes', name: 'Râga Mayamalavagowula', tokens: ['1', 'b2', '3', '4', '5', 'b6', '7'] },
        { id: 'raga_kanakangi', group: 'Gammes indiennes', name: '1. Kanakangi', tokens: ['1', 'b2', 'bb3', '4', '5', 'b6', 'bb7'] },
        { id: 'raga_ratnangi', group: 'Gammes indiennes', name: '2. Ratnangi', tokens: ['1', 'b2', 'bb3', '4', '5', 'b6', 'b7'] },
        { id: 'raga_ganamurti', group: 'Gammes indiennes', name: '3. Ganamurti', tokens: ['1', 'b2', 'bb3', '4', '5', 'b6', '7'] },
        { id: 'raga_vanaspati', group: 'Gammes indiennes', name: '4. Vanaspati', tokens: ['1', 'b2', 'bb3', '4', '5', '6', 'b7'] },
        { id: 'raga_manavati', group: 'Gammes indiennes', name: '5. Manavati', tokens: ['1', 'b2', 'bb3', '4', '5', '6', '7'] },
        { id: 'raga_tanarupi', group: 'Gammes indiennes', name: '6. Tanarupi', tokens: ['1', 'b2', 'bb3', '4', '5', '#6', '7'] },
        // Les Dastgāhs
        { id: 'dastgah_shur', group: 'Les Dastgāhs', name: 'Dastgâh Shur', tokens: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'dastgah_mahur', group: 'Les Dastgāhs', name: 'Dastgâh Mâhur', tokens: ['1', '2', '3', '4', '5', '6', '7'] },
        { id: 'dastgah_homayoun', group: 'Les Dastgāhs', name: 'Dastgâh Homayoun', tokens: ['1', 'b2', '3', '4', '5', 'b6', 'b7'] },
        { id: 'dastgah_chahargah', group: 'Les Dastgāhs', name: 'Dastgâh Chahârgâh', tokens: ['1', 'b2', '3', '4', '5', 'b6', '7'] },
        // Les Gamelans
        { id: 'gamelan_slendro', group: 'Les Gamelans', name: 'Gamelan Slendro', tokens: ['1', '2', '4', '5', 'b7'] },
        { id: 'gamelan_pelog', group: 'Les Gamelans', name: 'Gamelan Pelog', tokens: ['1', 'b2', 'b3', '5', 'b6'] },
        { id: 'gamelan_degung', group: 'Les Gamelans', name: 'Gamelan Degung', tokens: ['1', '2', 'b3', '5', '6'] },
        { id: 'gamelan_madra', group: 'Les Gamelans', name: 'Gamelan Madra', tokens: ['1', '2', '4', 'b6', 'b7'] }
    ];

    function scaleById(id) {
        return SCALES.find(s => s.id === id) || SCALES[0];
    }

    // « Eb » → { letter: 'E', acc: -1, pc: 3 }
    function parseRoot(key) {
        const letter = key[0];
        const acc = key[1] === '#' ? 1 : key[1] === 'b' ? -1 : 0;
        return { letter, acc, pc: (((NATURAL_PC[letter] + acc) % 12) + 12) % 12 };
    }

    function accSymbol(n) {
        if (n === 0) return '';
        return n > 0 ? '♯'.repeat(n) : '♭'.repeat(-n);
    }

    // « Eb » → « E♭ »
    function rootLabel(key) {
        return key[0] + (key[1] === '#' ? '♯' : key[1] === 'b' ? '♭' : '');
    }

    // « b3 » → { deg: 3, acc: -1 }
    function parseToken(tok) {
        let acc = 0, i = 0;
        while (tok[i] === 'b' || tok[i] === '#') { acc += tok[i] === '#' ? 1 : -1; i++; }
        return { deg: parseInt(tok.slice(i), 10), acc };
    }

    // Nom de la note du degré `tok` dans la gamme de fondamentale `rootKey` (« C », « D♭ », « F♯ »…).
    function noteName(rootKey, tok) {
        const r = parseRoot(rootKey), p = parseToken(tok);
        const pc = (((r.pc + MAJOR[p.deg - 1] + p.acc) % 12) + 12) % 12;
        const spell = (li) => {
            const lt = LETTERS[((li % 7) + 7) % 7];
            let d = (((pc - NATURAL_PC[lt]) % 12) + 12) % 12;
            if (d > 6) d -= 12;
            return { lt, d };
        };
        const base = LETTERS.indexOf(r.letter) + p.deg - 1;
        let best = spell(base);
        // Plus de deux dièses ou bémols (ex. Do♭♭♭) : on prend la lettre voisine, comme Mode Machine
        if (Math.abs(best.d) > 2) {
            [1, -1, 2, -2].forEach(sh => { const alt = spell(base + sh); if (Math.abs(alt.d) < Math.abs(best.d)) best = alt; });
        }
        return best.lt + accSymbol(best.d);
    }

    // « b3 » → « ♭III »
    function degreeLabel(tok) {
        const p = parseToken(tok);
        return accSymbol(p.acc) + ROMAN[p.deg - 1];
    }

    // Écart en demi-tons d'un degré par rapport à la fondamentale.
    function semitones(tok) {
        const p = parseToken(tok);
        return MAJOR[p.deg - 1] + p.acc;
    }

    // Lignes de la grille mélodique, de la plus grave (idx 0 = fondamentale) à la plus aiguë.
    // `octave` : octave de la fondamentale (4 → Do central = Do4, MIDI 60) ; `range` : nombre d'octaves affichées.
    function rows(rootKey, scaleId, octave, range) {
        const sc = scaleById(scaleId), r = parseRoot(rootKey), n = sc.tokens.length;
        const semis = sc.tokens.map(semitones);
        const base = 12 * (octave + 1) + r.pc;
        const out = [];
        for (let idx = 0; idx <= n * range; idx++) {
            const k = Math.floor(idx / n), j = idx % n;
            out.push({
                idx,
                midi: base + semis[j] + 12 * k,
                name: noteName(rootKey, sc.tokens[j]),
                degree: degreeLabel(sc.tokens[j]),
                isRoot: j === 0,
                octave: octave + k
            });
        }
        return out;
    }

    // Nom de note à la façon de soundfont-player (« C#4 »), à partir d'un numéro MIDI.
    function midiName(midi) {
        return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12] + (Math.floor(midi / 12) - 1);
    }

    return { ROOTS, SCALES, scaleById, parseRoot, rootLabel, accSymbol, parseToken, noteName, degreeLabel, semitones, rows, midiName };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Theory;
}
