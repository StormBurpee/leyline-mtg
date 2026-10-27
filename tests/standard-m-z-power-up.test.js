import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  legalActions,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = [
  'Mammoth Bellow',
  'Tend the Sprigs',
  'Offender at Large',
  'Thunder Magic',
  'Ninja of the Hand',
  'She-Hulk, Jade Defender',
  'Unliving Legionnaire',
  'Five Five Elephant Token',
  'Reach Treefolk Token',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('7 complete v52 cards and two exact green creature tokens compile and round trip every clause', () => {
  for (const source of sources) {
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[source.name]);
    assert.equal(compiled.definition.text, source.rulesText);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, source.name + JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});

import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefieldBatch, stabilize } from '../packages/engine/src/effects.js';
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
test('Ninja power-up discounts its full printed mana cost on entry and cannot activate twice', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const c = enter(s, 'Ninja of the Hand');
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 1);
  lands(s, 'Swamp', 5);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'activate' && a.card === c.id),
    false,
  );
});
test('She-Hulk and Legionnaire keep their self counters when choosing zero optional targets', () => {
  for (const [name, land, n, counters] of [
    ['She-Hulk, Jade Defender', 'Forest', 2, 1],
    ['Unliving Legionnaire', 'Swamp', 3, 2],
  ]) {
    let s = fixture();
    lands(s, land, n);
    const c = enter(s, name);
    s = act(s, 'activate', { card: c.id, ability: 0, targets: { chosen: [] } });
    s = resolve(s);
    assert.equal(s.objects[c.id].plusCounters, counters);
  }
});
test('Mammoth Bellow creates the exact vanilla five-five Elephant', () => {
  let s = fixture();
  lands(s, 'Forest', 3);
  lands(s, 'Island', 1);
  lands(s, 'Mountain', 1);
  const c = put(s, 'Mammoth Bellow', 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  const e = Object.values(s.objects).find(
    (o) => o.name === 'Five Five Elephant Token' && o.zone === 'battlefield',
  );
  assert(e);
  assert.equal(stats(s, e).power, 5);
});
test('Tend the Sprigs evaluates seven lands or Treefolk after the searched land enters', () => {
  let s = fixture();
  lands(s, 'Forest', 6);
  const target = put(s, 'Forest', 0, 'library');
  const c = put(s, 'Tend the Sprigs', 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  s = act(s, 'searchLibrary', { cards: [target.id] });
  const t = Object.values(s.objects).find(
    (o) => o.name === 'Reach Treefolk Token' && o.zone === 'battlefield',
  );
  assert(t);
  assert.equal(stats(s, t).power, 3);
  assert.equal(stats(s, t).toughness, 4);
  assert(hasKeyword(s, t, 'reach'));
});
test('Thunder Magic applies the additional cost and deals eight damage in its third mode', () => {
  let s = fixture();
  lands(s, 'Mountain', 8);
  const target = put(s, 'Serra Angel', 1);
  const c = put(s, 'Thunder Magic', 0, 'hand');
  s = act(s, 'cast', { card: c.id, mode: 2, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});
import { notifyTriggers } from '../packages/engine/src/model.js';
test('Offender supports zero entry targets and a chosen opposing creature on face-up', () => {
  let s = fixture();
  const enemy = put(s, 'Grizzly Bears', 1);
  const c = enter(s, 'Offender at Large');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  notifyTriggers(s, 'faceUp', { object: s.objects[c.id], controller: 0 });
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(enemy)] } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[enemy.id]).power, 4);
});
