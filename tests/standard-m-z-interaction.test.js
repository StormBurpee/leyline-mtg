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
  'They Went This Way',
  'Mind Drill Assailant',
  'Monoist Circuit-Feeder',
  'Mindsparker',
  'Static Snare',
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
test('5 complete next-release interaction cards compile and round trip every clause', () => {
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
import { move, notifyTriggers } from '../packages/engine/src/model.js';
test('They Went This Way still investigates when the legal optional search finds nothing', () => {
  let s = fixture();
  lands(s, 'Forest', 3);
  const c = put(s, 'They Went This Way', 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  s = act(s, 'searchLibrary', { cards: [] });
  assert(Object.values(s.objects).some((o) => o.name === 'Clue Token' && o.zone === 'battlefield'));
});
test('Mind Drill updates threshold live and accepts either hybrid color for surveil', () => {
  let s = fixture();
  const c = put(s, 'Mind Drill Assailant');
  for (let i = 0; i < 6; i++) put(s, 'Forest', 0, 'graveyard');
  assert.equal(stats(s, c).power, 2);
  put(s, 'Forest', 0, 'graveyard');
  assert.equal(stats(s, c).power, 5);
  lands(s, 'Swamp', 3);
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
});
test('Monoist targets both sides and counts artifacts at resolution', () => {
  let s = fixture();
  const friend = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Serra Angel', 1);
  enter(s, 'Monoist Circuit-Feeder');
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { friendly: [ref(friend)], enemy: [ref(enemy)] } });
  put(s, 'Treasure Token');
  s = resolve(s);
  assert.equal(stats(s, s.objects[friend.id]).power, 4);
  assert.equal(stats(s, s.objects[enemy.id]).toughness, 2);
});
test('Mindsparker triggers once for a white-blue spell and ignores creature spells', () => {
  let s = fixture();
  put(s, 'Mindsparker');
  const spell = put(s, 'No More Lies', 1, 'hand');
  notifyTriggers(s, 'cast', { object: spell, controller: 1 });
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
  const creature = put(s, 'Serra Angel', 1, 'hand');
  notifyTriggers(s, 'cast', { object: creature, controller: 1 });
  stabilize(s);
  assert.equal(s.stack.length, 0);
});
test('Static Snare discounts for either players attacking creatures and returns its linked exile', () => {
  let s = fixture();
  lands(s, 'Plains', 3);
  const one = put(s, 'Grizzly Bears', 1);
  const two = put(s, 'Serra Angel', 1);
  s.combat.attackers = [ref(one), ref(two)];
  const artifact = put(s, 'Ornithopter', 1);
  const spell = put(s, 'Static Snare', 0, 'hand');
  const cast = legalActions(s, 0).find((a) => a.type === 'cast' && a.card === spell.id);
  assert(cast);
  s = act(s, 'cast', cast);
  s = resolve(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(artifact) });
  s = resolve(s);
  assert.equal(s.objects[artifact.id].zone, 'exile');
  move(s, s.objects[spell.id], 'graveyard');
  stabilize(s);
  assert.equal(s.objects[artifact.id].zone, 'battlefield');
});
