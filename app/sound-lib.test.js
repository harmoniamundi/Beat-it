// sound-lib.test.js — vérifie la bibliothèque de sons : « node app/sound-lib.test.js »
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FMSynth: FM } = require('./audio/fm-synth.js');
const { SoundLib: Lib } = require('./audio/sound-lib.js');
const sf = require('./audio/local-soundfonts.js');

const slots = Lib.slots();
assert.strictEqual(slots.length, 15, '15 instruments');

// Chaque instrument : des sons aux identifiants uniques, de sorte connue, avec leurs réglages dans les bornes
slots.forEach((slot) => {
    const list = Lib.voiceList(slot), ids = list.map((v) => v.id);
    assert.strictEqual(new Set(ids).size, ids.length, slot + ' : identifiants en double');
    list.forEach((v) => {
        assert.ok(['sf', 'bank', 'synth', 'fm'].includes(v.kind), slot + '/' + v.id + ' : sorte inconnue');
        assert.ok(v.label && typeof v.label === 'string', slot + '/' + v.id + ' : nom manquant');
        Object.keys(v.out || {}).forEach((k) => {
            assert.ok(Lib.OUT[k], slot + '/' + v.id + ' : réglage inconnu « ' + k + ' »');
            assert.ok(v.out[k] >= Lib.OUT[k][0] && v.out[k] <= Lib.OUT[k][1], slot + '/' + v.id + ' : « ' + k + ' » hors bornes');
        });
        if (v.kind === 'synth') {
            assert.ok(Lib.WAVES.some((w) => w[0] === v.syn.wave), slot + '/' + v.id + ' : forme d\'onde inconnue');
            assert.ok(v.lvl > 0 && v.lvl < 1, slot + '/' + v.id + ' : niveau à régler');
            Object.keys(v.syn).forEach((k) => { if (k !== 'wave') assert.ok(Lib.SYN[k] && v.syn[k] >= Lib.SYN[k][0] && v.syn[k] <= Lib.SYN[k][1], slot + '/' + v.id + ' : synthé « ' + k + ' » hors bornes'); });
        }
        if (v.kind === 'fm') assert.ok(FM.FACTORY[slot], slot + ' : pas de patch FM d\'usine');
        // un son d'usine est stable après nettoyage, et propose bien ce qu'il annonce
        const s = Lib.withVoice(slot, null, v.id);
        assert.strictEqual(s.voice, v.id);
        assert.deepStrictEqual(Lib.cleanSound(slot, JSON.parse(JSON.stringify(s))), s, slot + '/' + v.id + ' : son instable');
        assert.strictEqual(!!s.syn, v.kind === 'synth');
        assert.strictEqual(!!s.fm, v.kind === 'fm');
    });
    assert.deepStrictEqual(Lib.defaultSound(slot), Lib.withVoice(slot, null, Lib.defaultVoiceId(slot)));
});
// les 12 instruments qui avaient un patch FM peuvent y revenir ; piano, basse et trompette non
slots.forEach((slot) => assert.strictEqual(Lib.voiceList(slot).some((v) => v.id === 'fm'), !!FM.FACTORY[slot], slot));
['piano', 'bass', 'trumpet'].forEach((k) => assert.strictEqual(Lib.voiceList(k)[0].kind, 'sf', k));

// Fichiers d'échantillons : la liste de local-soundfonts.js = celle de SoundLib, et chaque fichier existe et se lit
assert.deepStrictEqual(sf.LOCAL_BANK_NAMES.slice().sort(), Lib.bankFiles().slice().sort(), 'local-soundfonts.js et sound-lib.js ne parlent pas des mêmes fichiers');
sf.LOCAL_BANK_NAMES.forEach((name) => {
    const file = path.join(__dirname, 'sounds', 'Bank', name + '.js');
    assert.ok(fs.existsSync(file), 'fichier manquant : ' + name);
    const win = {};
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: win });
    const d = win.SEQ_BANK && win.SEQ_BANK[name];
    assert.ok(d && d.notes, name + ' : contenu illisible');
    const keys = Object.keys(d.notes).map(Number).sort((a, b) => a - b);
    assert.ok(keys.length >= 12, name + ' : trop peu de notes');
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i] - keys[i - 1] <= 4, name + ' : trou de plus de 3 demi-tons entre ' + keys[i - 1] + ' et ' + keys[i]);
    keys.forEach((k) => assert.ok(/^data:audio\/mpeg;base64,/.test(d.notes[k]), name + ' ' + k + ' : mauvais format'));
    assert.ok(keys[0] <= 60 && keys[keys.length - 1] >= 84, name + ' : étendue trop étroite');
});
assert.strictEqual(Lib.bankUrl('flute'), 'app/sounds/Bank/flute.js');

// Conversions
assert.ok(Math.abs(Lib.attSec(0) - 0.002) < 1e-6);
assert.ok(Math.abs(Lib.attSec(99) - 2.4) < 1e-6);
assert.ok(Math.abs(Lib.relSec(51) - 0.3) < 0.02, 'relâchement d\'origine des échantillons ≈ 0,3 s');
assert.ok(Math.abs(Lib.attSec(22) - 0.01) < 0.001, 'attaque d\'origine des échantillons ≈ 10 ms');
assert.strictEqual(Lib.cutHz(127), 20000);
assert.strictEqual(Lib.sliderOf(Lib.relSec, Lib.relSec(37)), 37);

// Nettoyage : n'importe quoi donne un son valide
assert.deepStrictEqual(Lib.cleanSound('flute', null), Lib.defaultSound('flute'));
assert.deepStrictEqual(Lib.cleanSound('flute', 'abc'), Lib.defaultSound('flute'));
const dirty = Lib.cleanSound('guitar', { v: 2, voice: 'inconnu', out: { cut: 999, att: -5, tune: 'x', pan: 64.4 } });
assert.strictEqual(dirty.voice, 'nylon');
assert.strictEqual(dirty.out.cut, 127); assert.strictEqual(dirty.out.att, 0); assert.strictEqual(dirty.out.tune, 0); assert.strictEqual(dirty.out.pan, 64);
const synDirty = Lib.cleanSound('pad', { v: 2, voice: 'warm', syn: { wave: 'zzz', uni: 99, det: -4, fc: 50.6 } });
assert.strictEqual(synDirty.syn.wave, 'saw'); assert.strictEqual(synDirty.syn.uni, 5); assert.strictEqual(synDirty.syn.det, 0); assert.strictEqual(synDirty.syn.fc, 51);
assert.strictEqual(Lib.cleanSound('piano', { v: 2, voice: 'fm' }).voice, 'piano', 'le piano n\'a pas de mode FM');

// Un nouveau son garde volume, panoramique et accord, et reprend le reste
const pre = Lib.withVoice('strings', null, 'ensemble');
pre.out.vol = 80; pre.out.pan = 30; pre.out.tune = 7; pre.out.rev = 3; pre.out.att = 5;
const next = Lib.withVoice('strings', pre, 'cello');
assert.strictEqual(next.out.vol, 80); assert.strictEqual(next.out.pan, 30); assert.strictEqual(next.out.tune, 7);
assert.strictEqual(next.out.rev, Lib.voice('strings', 'cello').out.rev); assert.strictEqual(next.out.att, Lib.voice('strings', 'cello').out.att);
const fmNext = Lib.withVoice('flute', pre, 'fm');
assert.deepStrictEqual(fmNext.fm, FM.FACTORY.flute); assert.ok(fmNext.fm !== FM.FACTORY.flute, 'copie, pas la référence');

// Anciennes sauvegardes (avant les sons et les curseurs)
const oldFactory = { fm: FM.clone(FM.FACTORY.guitar), out: { cut: 127, res: 0, drv: 0, dtime: 15, dfb: 40, dmix: 0, tune: 0, pan: 64, vol: 127 } };
assert.deepStrictEqual(Lib.cleanSound('guitar', oldFactory), Lib.defaultSound('guitar'), 'un patch d\'usine jamais touché prend le nouveau son');
const oldTouched = FM.clone(oldFactory); oldTouched.fm.ops[0].lvl = 50; oldTouched.out.pan = 90; oldTouched.out.dmix = 33;
const mig = Lib.cleanSound('guitar', oldTouched);
assert.strictEqual(mig.voice, 'fm'); assert.strictEqual(mig.fm.ops[0].lvl, 50); assert.strictEqual(mig.out.pan, 90); assert.strictEqual(mig.out.dmix, 33);
const oldSample = { env: [0.3, 0, 1, 1.2], out: { vol: 100 } };
const migS = Lib.cleanSound('piano', oldSample);
assert.strictEqual(migS.voice, 'piano'); assert.ok(Math.abs(Lib.attSec(migS.out.att) - 0.3) < 0.06); assert.ok(Math.abs(Lib.relSec(migS.out.rel) - 1.2) < 0.15); assert.strictEqual(migS.out.vol, 100);
assert.deepStrictEqual(Lib.cleanSound('piano', { env: [0, 0, 1, 0], out: {} }), Lib.defaultSound('piano'));
// l'ancien texte exporté depuis l'éditeur se réimporte
assert.strictEqual(Lib.cleanSound('guitar', JSON.parse(JSON.stringify(oldTouched))).voice, 'fm');

// Quels curseurs pour quelle sorte de son
assert.strictEqual(Lib.applies('sf', 'vib'), false); assert.strictEqual(Lib.applies('bank', 'vib'), true);
assert.strictEqual(Lib.applies('fm', 'att'), false); assert.strictEqual(Lib.applies('synth', 'att'), true);

console.log('OK : sound-lib.test.js');
