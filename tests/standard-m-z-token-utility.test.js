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
  'Regal Caracal',
  'Ogre Chitterlord',
  'Turtle Blimp',
  "Mourner's Surprise",
  'Totentanz, Swarm Piper',
  'Vraska, Soul of Stone',
  'Pitiless Fists',
  'Lifelink Cat Token',
  'Sculpture Treasure Token',
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
test('7 complete next-release token cards and two exact tokens compile and round trip every clause', () => {
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
test('Regal Caracal creates lifelink Cats without accidentally granting itself its anthem', () => {
  let s = fixture();
  const c = enter(s, 'Regal Caracal');
  s = resolve(s);
  const cats = Object.values(s.objects).filter(
    (o) => o.name === 'Lifelink Cat Token' && o.zone === 'battlefield',
  );
  assert.equal(cats.length, 2);
  for (const o of cats) {
    assert.equal(stats(s, o).power, 2);
    assert(hasKeyword(s, o, 'lifelink'));
  }
  assert.equal(stats(s, s.objects[c.id]).power, 3);
  assert.equal(hasKeyword(s, s.objects[c.id], 'lifelink'), false);
});
test('Ogre Chitterlord counts the Rats it just created before applying its bonus', () => {
  let s = fixture();
  for (let i = 0; i < 3; i++) put(s, 'Nonblocking Rat Token');
  enter(s, 'Ogre Chitterlord');
  s = resolve(s);
  const rats = Object.values(s.objects).filter(
    (o) => o.name === 'Nonblocking Rat Token' && o.zone === 'battlefield',
  );
  assert.equal(rats.length, 5);
  for (const o of rats) assert.equal(stats(s, o).power, 3);
});
test('Mourner Surprise makes the exact Mercenary even with zero graveyard targets', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const c = put(s, "Mourner's Surprise", 0, 'hand');
  s = act(s, 'cast', { card: c.id, targets: { chosen: [] } });
  s = resolve(s);
  assert(
    Object.values(s.objects).some((o) => o.name === 'Mercenary Token' && o.zone === 'battlefield'),
  );
});
test('Totentanz creates one Rat when it dies and ignores ordinary token deaths', () => {
  let s = fixture();
  const c = put(s, 'Totentanz, Swarm Piper');
  const token = put(s, 'Mutant Token');
  move(s, token, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
  move(s, c, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.name === 'Nonblocking Rat Token' && o.zone === 'battlefield',
    ).length,
    1,
  );
});
test('Vraska Sculpture Treasure is a creature and summoning sickness applies to its mana ability', () => {
  let s = fixture();
  put(s, 'Vraska, Soul of Stone');
  const spell = put(s, 'Opt', 0, 'hand');
  notifyTriggers(s, 'cast', { object: spell, controller: 0 });
  stabilize(s);
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Sculpture Treasure Token' && o.zone === 'battlefield',
  );
  assert(token);
  assert.equal(stats(s, token).power, 1);
  assert(hasKeyword(s, token, 'vigilance'));
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'tapMana' && a.card === token.id),
    false,
  );
  token.controlledSince = s.turn - 1;
  assert(legalActions(s, 0).some((a) => a.type === 'tapMana' && a.card === token.id));
});
test('Pitiless Fists supports declining its optional fight without losing the Aura bonus', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const creature = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Serra Angel', 1);
  const c = put(s, 'Pitiless Fists', 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: ref(creature) });
  s = resolve(s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[creature.id]).power, 4);
  assert.equal(s.objects[enemy.id].damage, 0);
});
test('Pitiless Fists fights using the enchanted creature including its static bonus', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const creature = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const c = put(s, 'Pitiless Fists', 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: ref(creature) });
  s = resolve(s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(enemy)] } });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
  assert.equal(s.objects[creature.id].damage, 2);
  assert.equal(s.objects[creature.id].zone, 'battlefield');
});
