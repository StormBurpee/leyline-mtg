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
  'Simulacrum Synthesizer',
  'Volatile Fault',
  'Silver Deputy',
  'Unfortunate Accident',
  'Restless Fortress',
  'Restless Prairie',
  'Yoshimaru, Scrappy Stray',
  'Scaling Construct Token',
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
test('7 complete v51 cards and an exact scaling Construct compile and round trip every clause', () => {
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
test('Synthesizer ignores itself and cheap artifacts, then creates a Construct that scales with all your artifacts', () => {
  let s = fixture();
  const c = put(s, 'Simulacrum Synthesizer');
  const cheap = put(s, 'Ornithopter');
  notifyTriggers(s, 'enter', { object: cheap, controller: 0 });
  notifyTriggers(s, 'enter', { object: c, controller: 0 });
  stabilize(s);
  assert.equal(s.stack.length, 0);
  const expensive = put(s, 'Magitek Armor');
  notifyTriggers(s, 'enter', { object: expensive, controller: 0 });
  stabilize(s);
  while (s.stack.length) s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Scaling Construct Token' && o.zone === 'battlefield',
  );
  assert(token);
  assert.equal(stats(s, token).power, 4);
  move(s, s.objects[cheap.id], 'graveyard');
  assert.equal(stats(s, token).power, 3);
});
test('Silver Deputy puts the searched Desert on top after shuffling', () => {
  let s = fixture();
  const desert = put(s, 'Soured Springs', 0, 'library');
  enter(s, 'Silver Deputy');
  s = resolve(s);
  s = act(s, 'searchLibrary', { cards: [desert.id] });
  assert.equal(s.players[0].library[0], desert.id);
});
test('Volatile Fault gives its opponent an untapped basic and its controller a Treasure', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const v = put(s, 'Volatile Fault');
  const target = put(s, 'Soured Springs', 1);
  const basic = put(s, 'Forest', 1, 'library');
  s = act(s, 'activate', { card: v.id, ability: 0, target: ref(target) });
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  s = act(s, 'searchLibrary', { cards: [basic.id] }, 1);
  assert.equal(s.objects[basic.id].zone, 'battlefield');
  assert.equal(s.objects[basic.id].tapped, false);
  assert(
    Object.values(s.objects).some(
      (o) => o.name === 'Treasure Token' && o.controller === 0 && o.zone === 'battlefield',
    ),
  );
});
test('Unfortunate Accident can pay for both Spree modes and create its Mercenary after destruction', () => {
  let s = fixture();
  lands(s, 'Swamp', 5);
  const target = put(s, 'Grizzly Bears', 1);
  const c = put(s, 'Unfortunate Accident', 0, 'hand');
  const cmd = legalActions(s, 0).find((a) => a.type === 'cast' && a.card === c.id && a.mode === 2);
  assert(cmd);
  s = act(s, 'cast', cmd);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert(
    Object.values(s.objects).some((o) => o.name === 'Mercenary Token' && o.zone === 'battlefield'),
  );
});
test('Restless Fortress becomes the exact Nightmare and drains on attack', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  lands(s, 'Swamp', 2);
  const c = put(s, 'Restless Fortress');
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[c.id]).power, 1);
  assert.equal(stats(s, s.objects[c.id]).toughness, 4);
  notifyTriggers(s, 'attack', { object: s.objects[c.id] });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});
test('Prairie boosts other creatures only and Yoshimaru excludes itself as the fighter', () => {
  let s = fixture();
  const land = put(s, 'Restless Prairie');
  const bear = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'attack', { object: land });
  stabilize(s);
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  const enemy = put(s, 'Grizzly Bears', 1);
  const y = enter(s, 'Yoshimaru, Scrappy Stray');
  assert.throws(() =>
    act(s, 'chooseTriggerTargets', { targets: { fighter: [ref(y)], victim: [ref(enemy)] } }),
  );
  s = act(s, 'chooseTriggerTargets', { targets: { fighter: [ref(bear)], victim: [ref(enemy)] } });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
  assert.equal(s.objects[y.id].zone, 'battlefield');
});
