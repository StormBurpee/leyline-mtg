import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, definition, stats, keywords, validateDefinition } from '../src/index.js';
import { move, ref, notifyTriggers, queueTrigger } from '../src/model.js';
import { resolveEffects, continueResolution, stabilize } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const tokens = (s) => Object.values(s.objects).filter((o) => o.token && o.zone === 'battlefield');
const copy = (count = 1) => ({ op: 'copyToken', subject: 'source', count });

test('Gruff enters as two full 3/3 copies with trample and both abilities, never recursing', () => {
  let s = fixture();
  const source = put(s, 'Gruff Triplets');
  source.plusCounters = 5;
  notifyTriggers(s, 'enter', { object: source });
  stabilize(s);
  s = resolve(s);
  assert.equal(tokens(s).length, 2);
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
  for (const token of tokens(s)) {
    assert.deepEqual(stats(s, token), { power: 3, toughness: 3 });
    assert.ok(keywords(s, token).includes('trample'));
    assert.deepEqual(definition(s, token).triggers, CARDS['Gruff Triplets'].triggers);
  }
});

test('Gruff death uses departure power and exact full name, both token and nontoken creatures, only its controller', () => {
  let s = fixture();
  const source = put(s, 'Gruff Triplets'),
    other = put(s, 'Gruff Triplets'),
    opponent = put(s, 'Gruff Triplets', 1),
    bear = put(s, 'Grizzly Bears');
  const faux = put(s, 'Gruff Triplets');
  faux.definitionOverride = { ...structuredClone(CARDS['Forest']), name: 'Gruff Triplets' };
  source.plusCounters = 4;
  queueTrigger(s, other, [copy()], 'copy');
  resolveEffects(s, s.pendingTriggers.pop());
  const token = tokens(s)[0];
  move(s, source, 'graveyard');
  move(s, source, 'battlefield');
  source.plusCounters = 20; // returned incarnation must not supply 23 power
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[other.id].plusCounters, 7);
  assert.equal(s.objects[token.id].plusCounters, 7);
  assert.equal(s.objects[source.id].plusCounters, 27);
  assert.equal(s.objects[opponent.id].plusCounters, 0);
  assert.equal(s.objects[bear.id].plusCounters, 0);
  assert.equal(s.objects[faux.id].plusCounters, 0);
});

test('source copy reads live copiable values or departure LKI, never a returned incarnation or temporary values', () => {
  for (const departed of [false, true]) {
    const s = fixture(),
      source = put(s, 'Gruff Triplets');
    queueTrigger(s, source, [copy(2)], 'copy');
    source.definitionOverride = {
      ...structuredClone(CARDS['Ornithopter']),
      name: 'Copied thopter',
    };
    source.plusCounters = 9;
    s.modifiers.push({
      objectId: source.id,
      incarnation: source.incarnation,
      power: 8,
      toughness: 8,
      keywords: ['haste'],
      expires: s.turn,
    });
    if (departed) {
      move(s, source, 'graveyard');
      move(s, source, 'battlefield');
      source.definitionOverride = structuredClone(CARDS['Grizzly Bears']);
    }
    resolveEffects(
      s,
      s.pendingTriggers.find((t) => t.label === 'copy'),
    );
    assert.equal(tokens(s).length, 2);
    for (const t of tokens(s)) {
      assert.equal(t.name, 'Copied thopter');
      assert.deepEqual(stats(s, t), { power: 0, toughness: 2 });
      assert.ok(!keywords(s, t).includes('haste'));
      assert.equal(t.plusCounters, 0);
    }
  }
});

test('source-copy batch enters simultaneously, including all mutual entry observers', () => {
  const s = fixture(),
    source = put(s, 'Soul Warden');
  queueTrigger(s, source, [copy(2)], 'copy');
  resolveEffects(s, s.pendingTriggers.shift());
  assert.equal(tokens(s).length, 2);
  assert.equal(s.pendingTriggers.length, 4);
});

test('source-copy batch pauses through both Cavern choices and resumes later instructions exactly once', () => {
  let s = fixture();
  const source = put(s, 'Cavern of Souls');
  source.chosenCreatureType = 'Elf';
  const entry = {
    kind: 'ability',
    name: 'Copy',
    source: ref(source),
    controller: 0,
    effects: [copy(2), { op: 'gainLife', amount: 3 }],
  };
  s.resolving = { entry, index: 0 };
  continueResolution(s);
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(tokens(s).length, 0);
  s = act(s, 'chooseCreatureType', { creatureType: 'Goblin' });
  assert.equal(tokens(s).length, 0);
  assert.equal(s.players[0].life, 20);
  s = act(s, 'chooseCreatureType', { creatureType: 'Human' });
  assert.equal(tokens(s).length, 2);
  assert.equal(s.players[0].life, 23);
  assert.deepEqual(
    tokens(s).map((o) => o.chosenCreatureType),
    ['Goblin', 'Human'],
  );
});

test('Sphinx death copies its last copiable values but token death never repeats', () => {
  let s = fixture();
  const source = put(s, 'Sphinx of False Conclusions');
  source.plusCounters = 10;
  move(s, source, 'graveyard');
  stabilize(s);
  s = resolve(s);
  const token = tokens(s)[0];
  assert.ok(token);
  assert.deepEqual(stats(s, token), { power: 4, toughness: 2 });
  assert.ok(keywords(s, token).includes('flash'));
  assert.ok(keywords(s, token).includes('flying'));
  move(s, token, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
});

test('Joo Dee activation pauses for surveil, then copies, then offers both original and token for sacrifice', () => {
  let s = fixture();
  lands(s, 'Swamp', 1);
  const source = put(s, 'Joo Dee, One of Many');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.equal(s.choice.action, 'surveil');
  assert.equal(tokens(s).length, 0);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  assert.equal(tokens(s).length, 1);
  assert.equal(s.choice.kind, 'sacrifice');
  assert.ok(s.choice.cards.includes(source.id));
  assert.ok(s.choice.cards.includes(tokens(s)[0].id));
});

test('invalid source binding and exact-name predicates fail closed', () => {
  for (const subject of ['eventSource', 'attached', 'graveyard'])
    assert.ok(
      validateDefinition({
        ...CARDS['Gruff Triplets'],
        triggers: [{ event: 'selfEnters', effects: [{ ...copy(), subject }] }],
      }).length,
    );
  for (const name of ['', 123, 'x'.repeat(201)])
    assert.ok(
      validateDefinition({
        ...CARDS['Gruff Triplets'],
        triggers: [
          { event: 'selfDies', effects: [{ op: 'counterAll', amount: 1, where: { name } }] },
        ],
      }).length,
    );
});

test('Sphinx attack draws then discards and copied token retains that complete ability', () => {
  let s = fixture();
  const source = put(s, 'Sphinx of False Conclusions');
  notifyTriggers(s, 'attack', { object: source });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.choice.kind, 'discardEffect');
});

test('Joo Dee removed before resolution still copies its departed incarnation after surveil', () => {
  let s = fixture();
  lands(s, 'Swamp', 1);
  const source = put(s, 'Joo Dee, One of Many');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.action, 'surveil');
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  assert.equal(tokens(s).length, 1);
  assert.equal(tokens(s)[0].name, 'Joo Dee, One of Many');
  assert.equal(s.choice.kind, 'sacrifice');
});
