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
  'The Unbeatable Squirrel Girl',
  'Mutable Explorer',
  'Sage of the Fang',
  'Seedship Broodtender',
  'Restless Cottage',
  'Rover Blades',
  'Green Squirrel Token',
  'Mutavault',
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
test('6 complete v52 cards and two exact tokens compile and round trip every clause', () => {
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
import { definition, hasType } from '../packages/engine/src/index.js';
import { hasSubtype } from '../packages/engine/src/creature-types.js';
import { notifyTriggers } from '../packages/engine/src/model.js';
test('Sage graveyard activation exiles itself and adds then doubles plus counters only', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const sage = put(s, 'Sage of the Fang', 0, 'graveyard');
  const target = put(s, 'Grizzly Bears');
  target.plusCounters = 2;
  target.stunCounters = 1;
  s = act(s, 'activate', { card: sage.id, ability: 0, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[sage.id].zone, 'exile');
  assert.equal(s.objects[target.id].plusCounters, 6);
  assert.equal(s.objects[target.id].stunCounters, 1);
});
test('Squirrel Girl counts herself when producing her activated batch', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const c = enter(s, 'The Unbeatable Squirrel Girl');
  s = resolve(s);
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.name === 'Green Squirrel Token' && o.zone === 'battlefield',
    ).length,
    3,
  );
});
test('Mutable Explorer creates a tapped noncreature Mutavault and its activation grants every creature type', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  enter(s, 'Mutable Explorer');
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Mutavault' && o.zone === 'battlefield',
  );
  assert(token);
  assert.equal(token.tapped, true);
  assert.equal(hasType(definition(s, token), 'creature'), false);
  s = act(s, 'activate', { card: token.id, ability: 0 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[token.id]).power, 2);
  assert(hasType(definition(s, s.objects[token.id]), 'land'));
  assert(hasSubtype(definition(s, s.objects[token.id]), 'Spider'));
});
test('Cottage creates Food even when no graveyard card is chosen', () => {
  let s = fixture();
  const c = put(s, 'Restless Cottage');
  notifyTriggers(s, 'attack', { object: c });
  stabilize(s);
  if (s.choice) s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  assert(Object.values(s.objects).some((o) => o.name === 'Food Token' && o.zone === 'battlefield'));
});
test('Rover Blades detaches when crew makes the Equipment a creature', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const r = put(s, 'Rover Blades');
  const b = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: r.id, ability: 0, target: ref(b) });
  s = resolve(s);
  assert(hasKeyword(s, s.objects[b.id], 'double strike'));
  s = act(s, 'crew', { card: r.id, cards: [b.id] });
  s = resolve(s);
  assert(hasType(definition(s, s.objects[r.id]), 'creature'));
  assert.equal(hasKeyword(s, s.objects[b.id], 'double strike'), false);
  assert(hasKeyword(s, s.objects[r.id], 'double strike'));
});
