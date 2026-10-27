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
  "Sandbenders' Storm",
  'Stagecoach Security',
  'Temur Monument',
  'Sinuous Benthisaur',
  'Rakish Scoundrel',
  'Sazh Katzroy',
  'Run Over',
  'Sultai Monument',
  'Zombie Druid Token',
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
test('8 complete v52 existing-mechanic utility cards compile and round trip every clause', () => {
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
import { move } from '../packages/engine/src/model.js';
test('Sandbenders Storm can earthbend a land and return it tapped after it dies', () => {
  let s = fixture();
  lands(s, 'Plains', 3);
  const target = put(s, 'Forest');
  const c = put(s, "Sandbenders' Storm", 0, 'hand');
  s = act(s, 'cast', { card: c.id, mode: 1, target: ref(target) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[target.id]).power, 3);
  move(s, s.objects[target.id], 'graveyard');
  stabilize(s);
  while (s.stack.length) s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
  assert.equal(s.objects[target.id].tapped, true);
});
test('Stagecoach entry grants its team vigilance and the +1/+1 bonus including itself', () => {
  let s = fixture();
  const target = put(s, 'Grizzly Bears');
  const c = enter(s, 'Stagecoach Security');
  s = resolve(s);
  assert.equal(stats(s, s.objects[target.id]).power, 3);
  assert(hasKeyword(s, s.objects[c.id], 'vigilance'));
  assert.deepEqual(CARDS['Stagecoach Security'].plot, { generic: 3, W: 1 });
});
test('Temur Monument searches only basic Forest Island Mountain cards and makes the exact Elephant', () => {
  let s = fixture();
  const mountain = put(s, 'Mountain', 0, 'library');
  const plains = put(s, 'Plains', 0, 'library');
  const c = enter(s, 'Temur Monument');
  s = resolve(s);
  assert(s.choice.cards.includes(mountain.id));
  assert.equal(s.choice.cards.includes(plains.id), false);
  s = act(s, 'searchLibrary', { cards: [mountain.id] });
  lands(s, 'Forest', 4);
  lands(s, 'Island', 1);
  lands(s, 'Mountain', 1);
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[c.id].zone, 'graveyard');
  assert(
    Object.values(s.objects).some(
      (o) => o.name === 'Five Five Elephant Token' && o.zone === 'battlefield',
    ),
  );
});
import { notifyTriggers } from '../packages/engine/src/model.js';
test('Run Over discounts when its own creature is a Mount, including a changeling', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const own = put(s, 'Sizzling Changeling');
  const enemy = put(s, 'Grizzly Bears', 1);
  const c = put(s, 'Run Over', 0, 'hand');
  s = act(s, 'cast', { card: c.id, targets: { fighter: [ref(own)], victim: [ref(enemy)] } });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
  assert.equal(s.objects[own.id].zone, 'battlefield');
});
test('Sazh can search a Bird then puts a counter and doubles plus counters on any creature', () => {
  let s = fixture();
  const bird = put(s, 'Plumecreed Mentor', 0, 'library');
  const target = put(s, 'Grizzly Bears', 1);
  const c = enter(s, 'Sazh Katzroy');
  s = resolve(s);
  s = act(s, 'searchLibrary', { cards: [bird.id] });
  s.objects[target.id].plusCounters = 2;
  notifyTriggers(s, 'attack', { object: s.objects[c.id] });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 6);
});
test('Sinuous Benthisaur counts Caves across battlefield and graveyard', () => {
  let s = fixture();
  put(s, 'Volatile Fault');
  put(s, 'Volatile Fault', 0, 'graveyard');
  put(s, 'Volatile Fault', 0, 'graveyard');
  enter(s, 'Sinuous Benthisaur');
  s = resolve(s);
  assert.equal(s.choice.cards.length, 3);
});
test('Rakish Scoundrel can grant indestructible to an opponent creature on entry', () => {
  let s = fixture();
  const target = put(s, 'Grizzly Bears', 1);
  enter(s, 'Rakish Scoundrel');
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert(hasKeyword(s, s.objects[target.id], 'indestructible'));
});
