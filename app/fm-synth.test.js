// fm-synth.test.js — vérifie le moteur FM : « node app/fm-synth.test.js »
const assert = require('assert');
const { FMSynth: FM } = require('./audio/fm-synth.js');

// 32 algorithmes ; chaque modulateur a un numéro plus grand que sa cible (le moteur calcule de OP6 à OP1)
assert.strictEqual(FM.ALGOS.length, 32);
FM.ALGOS.forEach((a, n) => {
    assert.ok(a.car.length >= 1, 'algorithme ' + (n + 1) + ' : aucun carrier');
    a.edges.forEach((e) => assert.ok(e[0] > e[1], 'algorithme ' + (n + 1) + ' : ' + (e[0] + 1) + ' module ' + (e[1] + 1)));
    // tout opérateur finit par atteindre un carrier
    for (let i = 0; i < 6; i++) {
        let cur = [i], ok = false, guard = 0;
        while (cur.length && !ok && guard++ < 8) {
            ok = cur.some((o) => a.car.indexOf(o) >= 0);
            cur = [].concat.apply([], cur.map((o) => a.edges.filter((e) => e[0] === o).map((e) => e[1])));
        }
        assert.ok(ok, 'algorithme ' + (n + 1) + ' : OP' + (i + 1) + ' n\'atteint aucun carrier');
    }
    const l = FM.layout(n + 1);
    assert.strictEqual(l.nodes.length, 6);
});

// patchs d'usine : valides, stables après nettoyage, audibles, sans saturation
const ids = Object.keys(FM.FACTORY);
assert.strictEqual(ids.length, 12);
ids.forEach((id) => {
    const p = FM.FACTORY[id];
    assert.deepStrictEqual(FM.cleanPatch(JSON.parse(JSON.stringify(p))), p, id + ' : patch instable');
    [36, 60, 84].forEach((m) => {
        const y = FM.render(p, m, 0.4, 1, 44100);
        let pk = 0;
        for (let i = 0; i < y.length; i++) { assert.ok(Number.isFinite(y[i]), id + ' : valeur non finie'); pk = Math.max(pk, Math.abs(y[i])); }
        assert.ok(pk > 0.01, id + ' ' + m + ' : silencieux');
        assert.ok(pk < 0.95, id + ' ' + m + ' : sature (' + pk.toFixed(2) + ')');
        assert.ok(y.length < 44100 * 8, id + ' : note trop longue');
    });
});

// un patch vide ne donne qu'un sinus, un opérateur coupé disparaît
const init = FM.initPatch();
const sine = FM.render(init, 69, 0.2, 1, 44100);
let zc = 0;
for (let i = 1; i < 4410; i++) if (sine[i - 1] < 0 && sine[i] >= 0) zc++;
assert.ok(Math.abs(zc - 44) <= 1, 'sinus à 440 Hz : ' + zc + ' périodes en 0,1 s');
init.ops[0].on = 0;
assert.strictEqual(FM.render(init, 69, 0.2, 1, 44100).length, 32);

// nettoyage : valeurs hors bornes ou absentes
const dirty = FM.cleanPatch({ algo: 99, fb: -3, ops: [{ lvl: 500, r: [1000, 'a'], det: 40 }] });
assert.strictEqual(dirty.algo, 32); assert.strictEqual(dirty.fb, 0); assert.strictEqual(dirty.ops[0].lvl, 99);
assert.strictEqual(dirty.ops[0].r[0], 99); assert.strictEqual(dirty.ops[0].det, 7); assert.strictEqual(dirty.ops.length, 6);
assert.strictEqual(FM.noteName(60), 'C3'); assert.strictEqual(FM.bpName(0), 'A-1');
assert.strictEqual(FM.freqLabel({ mode: 1, coarse: 3, fine: 21 }), '1621.81Hz');
assert.strictEqual(FM.freqLabel({ mode: 0, coarse: 1, fine: 3 }), 'f×1.0-3');
console.log('OK : fm-synth.test.js');
