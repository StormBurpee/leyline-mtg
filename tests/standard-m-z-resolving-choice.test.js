import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  definition,
  CARD_IDS,
  legalActions,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = ['Manifold Mouse', 'Sewer-veillance Cam', 'Wingnut, Bat on the Belfry'];
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
test('3 complete v55 resolving-choice cards compile and round trip every clause', () => {
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
import { notifyTriggers } from '../packages/engine/src/model.js';
import { move } from '../packages/engine/src/model.js';
test('Manifold Mouse selects the Mouse target before choosing the keyword during resolution', () => {
  let s = fixture();
  const mouse = put(s, 'Manifold Mouse'),
    other = put(s, 'Changeling Wayfinder');
  notifyTriggers(s, 'step', { player: 0, step: 'beginCombat' });
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(other) });
  assert.equal(s.choice, null);
  assert(!hasKeyword(s, s.objects[other.id], 'double strike'));
  s = resolve(s);
  assert.equal(s.choice.kind, 'effectChoice');
  s = act(s, 'chooseEffect', { option: 0 });
  assert(hasKeyword(s, s.objects[other.id], 'double strike'));
  assert(!hasKeyword(s, s.objects[other.id], 'trample'));
});
test('Manifold Mouse offspring creates a 1/1 token copy with the same combat trigger', () => {
  let s = fixture();
  lands(s, 'Mountain', 4);
  const card = put(s, 'Manifold Mouse', 0, 'hand');
  s = act(s, 'cast', { card: card.id, mode: 1 });
  s = resolve(s);
  s = resolve(s);
  const copy = Object.values(s.objects).find(
    (o) => o.token && o.name === 'Manifold Mouse' && o.zone === 'battlefield',
  );
  assert(copy);
  assert.equal(stats(s, copy).power, 1);
  assert.equal(stats(s, copy).toughness, 1);
  assert.deepEqual(definition(s, copy).triggers, CARDS['Manifold Mouse'].triggers);
});
test('Sewer-veillance Cam chooses tap, untap or no action only during resolution', () => {
  for (const option of [0, 1, 2]) {
    let s = fixture();
    const creature = put(s, 'Grizzly Bears');
    creature.tapped = option !== 0;
    enter(s, 'Sewer-veillance Cam');
    s = act(s, 'chooseTriggerTarget', { target: ref(creature) });
    s = resolve(s);
    assert.equal(s.choice.kind, 'effectChoice');
    s = act(s, 'chooseEffect', { option });
    assert.equal(s.objects[creature.id].tapped, option !== 1);
  }
});
test('Sewer-veillance Cam sacrifice queues its departure choice above the draw ability', () => {
  let s = fixture();
  lands(s, 'Island', 4);
  const creature = put(s, 'Grizzly Bears'),
    cam = put(s, 'Sewer-veillance Cam');
  creature.tapped = true;
  s = act(s, 'activate', { card: cam.id, ability: 0 });
  assert.equal(s.objects[cam.id].zone, 'graveyard');
  s = act(s, 'chooseTriggerTarget', { target: ref(creature) });
  s = resolve(s);
  assert.equal(s.choice.kind, 'effectChoice');
  s = act(s, 'chooseEffect', { option: 1 });
  assert.equal(s.objects[creature.id].tapped, false);
  assert.equal(s.players[0].hand.length, 0);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
});
test('Wingnut alliance chooses one keyword; attack pumps only other attacking creatures', () => {
  for (const [option, keyword] of [
    [0, 'flying'],
    [1, 'menace'],
    [2, 'haste'],
  ]) {
    let s = fixture();
    const wing = put(s, 'Wingnut, Bat on the Belfry');
    const bear = enter(s, 'Grizzly Bears');
    s = resolve(s);
    assert.equal(s.choice.kind, 'effectChoice');
    s = act(s, 'chooseEffect', { option });
    assert(hasKeyword(s, s.objects[wing.id], keyword));
    assert(!hasKeyword(s, s.objects[bear.id], keyword));
    const idle = put(s, 'Grizzly Bears');
    s.combat.attackers = [ref(s.objects[wing.id]), ref(s.objects[bear.id])];
    notifyTriggers(s, 'attack', { object: s.objects[wing.id], controller: 0 });
    stabilize(s);
    s = resolve(s);
    assert.equal(stats(s, s.objects[bear.id]).power, 3);
    assert.equal(stats(s, s.objects[idle.id]).power, 2);
    assert.equal(stats(s, s.objects[wing.id]).power, CARDS['Wingnut, Bat on the Belfry'].power);
  }
});
test('An invalid Manifold target fizzles before any keyword choice is offered', () => {
  let s = fixture();
  put(s, 'Manifold Mouse');
  const target = put(s, 'Changeling Wayfinder');
  notifyTriggers(s, 'step', { player: 0, step: 'beginCombat' });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice, null);
});
test('Cam alternatives reflect the target state at resolution, not at trigger announcement', () => {
  let s = fixture();
  const creature = put(s, 'Grizzly Bears');
  enter(s, 'Sewer-veillance Cam');
  s = act(s, 'chooseTriggerTarget', { target: ref(creature) });
  s.objects[creature.id].tapped = true;
  s = resolve(s);
  assert.deepEqual(
    s.choice.options.map((o) => o.index),
    [1, 2],
  );
  assert.throws(() => act(s, 'chooseEffect', { option: 0 }));
  s = act(s, 'chooseEffect', { option: 1 });
  assert.equal(s.objects[creature.id].tapped, false);
});
