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

    const SCALES = [
        { id: 'major',         group: 'Modes',         name: 'Majeure (ionien)',          tokens: ['1', '2', '3', '4', '5', '6', '7'] },
        { id: 'dorian',        group: 'Modes',         name: 'Dorien',                    tokens: ['1', '2', 'b3', '4', '5', '6', 'b7'] },
        { id: 'phrygian',      group: 'Modes',         name: 'Phrygien',                  tokens: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'lydian',        group: 'Modes',         name: 'Lydien',                    tokens: ['1', '2', '3', '#4', '5', '6', '7'] },
        { id: 'mixolydian',    group: 'Modes',         name: 'Mixolydien',                tokens: ['1', '2', '3', '4', '5', '6', 'b7'] },
        { id: 'minor',         group: 'Modes',         name: 'Mineure naturelle (éolien)', tokens: ['1', '2', 'b3', '4', '5', 'b6', 'b7'] },
        { id: 'locrian',       group: 'Modes',         name: 'Locrien',                   tokens: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'] },
        { id: 'harmonicMinor', group: 'Autres gammes', name: 'Mineure harmonique',        tokens: ['1', '2', 'b3', '4', '5', 'b6', '7'] },
        { id: 'melodicMinor',  group: 'Autres gammes', name: 'Mineure mélodique',         tokens: ['1', '2', 'b3', '4', '5', '6', '7'] },
        { id: 'pentMaj',       group: 'Autres gammes', name: 'Pentatonique majeure',      tokens: ['1', '2', '3', '5', '6'] },
        { id: 'pentMin',       group: 'Autres gammes', name: 'Pentatonique mineure',      tokens: ['1', 'b3', '4', '5', 'b7'] },
        { id: 'blues',         group: 'Autres gammes', name: 'Blues',                     tokens: ['1', 'b3', '4', 'b5', '5', 'b7'] },
        { id: 'wholeTone',     group: 'Autres gammes', name: 'Tons entiers',              tokens: ['1', '2', '3', '#4', '#5', 'b7'] }
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
        const letter = LETTERS[(LETTERS.indexOf(r.letter) + p.deg - 1) % 7];
        let diff = (((pc - NATURAL_PC[letter]) % 12) + 12) % 12;
        if (diff > 6) diff -= 12;
        return letter + accSymbol(diff);
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
