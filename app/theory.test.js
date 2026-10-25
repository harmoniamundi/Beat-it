// theory.test.js — vérifie l'écriture des gammes et les lignes de la grille mélodique.
// Lancer : node app/theory.test.js   (rien ne s'affiche de plus que « OK » quand tout va bien)

const assert = require('assert');
const Theory = require('./theory.js');

const names = (root, scaleId) => {
    const sc = Theory.scaleById(scaleId);
    return sc.tokens.map(t => Theory.noteName(root, t)).join(' ');
};

// Gammes majeures : une lettre par degré, altérations ajustées
assert.strictEqual(names('C', 'major'), 'C D E F G A B');
assert.strictEqual(names('Bb', 'major'), 'B♭ C D E♭ F G A');
assert.strictEqual(names('F#', 'major'), 'F♯ G♯ A♯ B C♯ D♯ E♯');
assert.strictEqual(names('Db', 'major'), 'D♭ E♭ F G♭ A♭ B♭ C');
assert.strictEqual(names('Eb', 'major'), 'E♭ F G A♭ B♭ C D');

// Modes et autres gammes
assert.strictEqual(names('D', 'dorian'), 'D E F G A B C');
assert.strictEqual(names('E', 'phrygian'), 'E F G A B C D');
assert.strictEqual(names('F', 'lydian'), 'F G A B C D E');
assert.strictEqual(names('G', 'mixolydian'), 'G A B C D E F');
assert.strictEqual(names('A', 'minor'), 'A B C D E F G');
assert.strictEqual(names('B', 'locrian'), 'B C D E F G A');
assert.strictEqual(names('A', 'harmonicMinor'), 'A B C D E F G♯');
assert.strictEqual(names('A', 'melodicMinor'), 'A B C D E F♯ G♯');
assert.strictEqual(names('C', 'pentMaj'), 'C D E G A');
assert.strictEqual(names('C', 'pentMin'), 'C E♭ F G B♭');
assert.strictEqual(names('C', 'blues'), 'C E♭ F F♯ G B♭');
assert.strictEqual(names('C', 'wholeTone'), 'C D E F♯ G♯ B♭');
assert.strictEqual(names('Bb', 'pentMin'), 'B♭ D♭ E♭ F A♭');
assert.strictEqual(names('D#', 'minor'), 'D♯ E♯ F♯ G♯ A♯ B C♯');

// Degrés
assert.strictEqual(Theory.degreeLabel('1'), 'I');
assert.strictEqual(Theory.degreeLabel('b3'), '♭III');
assert.strictEqual(Theory.degreeLabel('#4'), '♯IV');
assert.strictEqual(Theory.degreeLabel('b7'), '♭VII');

// Étiquettes de fondamentales
assert.strictEqual(Theory.rootLabel('Bb'), 'B♭');
assert.strictEqual(Theory.rootLabel('B'), 'B');
assert.strictEqual(Theory.rootLabel('F#'), 'F♯');

// Lignes de la grille : nombre, hauteurs, fondamentales
let r = Theory.rows('C', 'major', 4, 1);
assert.strictEqual(r.length, 8);
assert.deepStrictEqual(r.map(x => x.midi), [60, 62, 64, 65, 67, 69, 71, 72]);
assert.deepStrictEqual(r.filter(x => x.isRoot).map(x => x.octave), [4, 5]);

r = Theory.rows('C', 'major', 4, 2);
assert.strictEqual(r.length, 15);
assert.strictEqual(r[14].midi, 84);

r = Theory.rows('C', 'pentMin', 3, 1);
assert.deepStrictEqual(r.map(x => x.midi), [48, 51, 53, 55, 58, 60]);
assert.deepStrictEqual(r.map(x => x.name), ['C', 'E♭', 'F', 'G', 'B♭', 'C']);

r = Theory.rows('Bb', 'major', 3, 1);
assert.strictEqual(r[0].midi, 58);
assert.strictEqual(r[7].midi, 70);

r = Theory.rows('B', 'major', 4, 1);
assert.strictEqual(r[0].midi, 71);

// Toutes les gammes montent strictement
Theory.SCALES.forEach(sc => {
    const rows = Theory.rows('C', sc.id, 4, 2);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].midi > rows[i - 1].midi, sc.id + ' doit monter');
    assert.ok(rows.length <= 25, sc.id + ' tient dans 25 lignes');
});

// Gamme chromatique et gammes de Mode Machine
assert.strictEqual(names('C', 'chromatic'), 'C D♭ D E♭ E F F♯ G A♭ A B♭ B');
assert.strictEqual(names('A', 'chromatic'), 'A B♭ B C C♯ D D♯ E F F♯ G G♯');
assert.strictEqual(Theory.rows('C', 'chromatic', 4, 1).length, 13);
assert.strictEqual(Theory.rows('C', 'chromatic', 4, 2).length, 25);
assert.deepStrictEqual(Theory.rows('C', 'chromatic', 4, 1).map(x => x.midi), [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
assert.strictEqual(Theory.SCALES.length, 75);
assert.strictEqual(new Set(Theory.SCALES.map(s => s.id)).size, 75, 'identifiants uniques');
assert.strictEqual(names('C', 'phryg_dom'), 'C D♭ E F G A♭ B♭');
assert.strictEqual(names('C', 'byzantine'), 'C D♭ E F G A♭ B');
assert.strictEqual(names('C', 'hungarian_minor'), 'C D E♭ F♯ G A♭ B');
assert.strictEqual(names('C', 'altered'), 'C D♭ E♭ F♭ G♭ A♭ B♭');
assert.strictEqual(names('C', 'hirajoshi'), 'C D E♭ G A♭');
assert.strictEqual(names('C', 'gamelan_slendro'), 'C D F G B♭');
assert.strictEqual(names('C', 'diminished_hw'), 'C D♭ E♭ E F♯ G A B♭');
// Jamais plus de deux dièses ou bémols à une note
['C', 'C#', 'Db', 'D', 'Eb', 'F#', 'G#', 'Ab', 'Bb', 'B'].forEach(root => Theory.SCALES.forEach(sc =>
    sc.tokens.forEach(tok => assert.ok(!/(♯♯♯|♭♭♭)/.test(Theory.noteName(root, tok)), root + ' ' + sc.id + ' ' + tok))));

// Noms de notes pour soundfont-player
assert.strictEqual(Theory.midiName(60), 'C4');
assert.strictEqual(Theory.midiName(61), 'C#4');
assert.strictEqual(Theory.midiName(21), 'A0');

console.log('OK : theory.test.js');
