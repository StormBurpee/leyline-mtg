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
  'Shepherd of the Clouds',
  'Sally Pride, Lioness Leader',
  'Shady Informant',
  'Wildwood Mentor',
  'Unending Whisper',
  'Magitek Armor',
  'Super Suit',
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
test('7 complete next-release creature and Equipment cards compile and round trip every clause', () => {
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
import { notifyTriggers, move } from '../packages/engine/src/model.js';
test('Shepherd checks for a Mount at resolution and returns permanent cards including lands', () => {
  for (const mount of [false, true]) {
    let s = fixture();
    const land = put(s, 'Forest', 0, 'graveyard');
    enter(s, 'Shepherd of the Clouds');
    if (s.choice) s = act(s, 'chooseTriggerTarget', { target: ref(land) });
    if (mount) put(s, 'Sizzling Changeling');
    s = resolve(s);
    assert.equal(s.objects[land.id].zone, mount ? 'battlefield' : 'hand');
  }
});
test('Sally counts herself and other nontoken creatures then boosts every creature on attack', () => {
  let s = fixture();
  put(s, 'Grizzly Bears');
  put(s, 'Mutant Token');
  const c = enter(s, 'Sally Pride, Lioness Leader');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Mutant Token' && o.zone === 'battlefield')
      .length,
    3,
  );
  notifyTriggers(s, 'attack', { object: s.objects[c.id] });
  stabilize(s);
  s = resolve(s);
  for (const o of Object.values(s.objects).filter((o) => o.zone === 'battlefield'))
    assert.equal(o.plusCounters, 1);
});
test('Shady Informant retains any-target damage after leaving the battlefield', () => {
  let s = fixture();
  const c = put(s, 'Shady Informant');
  move(s, c, 'graveyard');
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
});
test('Wildwood triggers for artifact tokens and can boost an opponents attacking creature', () => {
  let s = fixture();
  const c = put(s, 'Wildwood Mentor');
  enter(s, 'Treasure Token');
  s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 1);
  const e = put(s, 'Grizzly Bears', 1);
  s.combat.attackers = [ref(c), ref(e)];
  notifyTriggers(s, 'attack', { object: s.objects[c.id] });
  stabilize(s);
  if (s.choice) s = act(s, 'chooseTriggerTarget', { target: ref(e) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[e.id]).power, 4);
});
test('Magitek Armor makes exactly the colorless 1/1 Hero and retains crew one', () => {
  let s = fixture();
  const c = enter(s, 'Magitek Armor');
  s = resolve(s);
  const hero = Object.values(s.objects).find(
    (o) => o.name === 'Hero Token' && o.zone === 'battlefield',
  );
  assert(hero);
  assert.equal(stats(s, hero).power, 1);
  assert.equal(CARDS['Magitek Armor'].crew, 1);
});
test('Super Suit attaches on entry and untaps the equipped creature', () => {
  let s = fixture();
  const creature = put(s, 'Grizzly Bears');
  creature.tapped = true;
  const c = enter(s, 'Super Suit');
  if (s.choice) s = act(s, 'chooseTriggerTarget', { target: ref(creature) });
  s = resolve(s);
  assert.equal(s.objects[creature.id].tapped, false);
  assert.equal(stats(s, s.objects[creature.id]).power, 3);
  assert.equal(stats(s, s.objects[creature.id]).toughness, 4);
});
