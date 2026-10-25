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
assert.strictEqual(names('C', 'blues'), 'C E♭ F G♭ G B♭');
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
    assert.ok(rows.length <= 15, sc.id + ' tient dans 15 lignes');
});

// Noms de notes pour soundfont-player
assert.strictEqual(Theory.midiName(60), 'C4');
assert.strictEqual(Theory.midiName(61), 'C#4');
assert.strictEqual(Theory.midiName(21), 'A0');

console.log('OK : theory.test.js');
