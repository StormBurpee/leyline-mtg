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
  'Restless Ridgeline',
  'Weftblade Enhancer',
  'Sanguine Savior',
  'Repulsor Blast',
  'Team Tactics',
  "Tam's Resistance",
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
test('6 complete v52 teamwork and trigger cards compile and round trip every clause', () => {
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
test('Repulsor Blast adds controller damage only when teamwork was actually paid', () => {
  for (const teamwork of [false, true]) {
    let s = fixture();
    lands(s, 'Mountain', 4);
    const bear = put(s, 'Grizzly Bears');
    const enemy = put(s, 'Serra Angel', 1);
    const c = put(s, 'Repulsor Blast', 0, 'hand');
    s = act(s, 'cast', {
      card: c.id,
      target: ref(enemy),
      ...(teamwork ? { additionalCost: { teamwork: [ref(bear)] } } : { additionalCost: null }),
    });
    s = resolve(s);
    assert.equal(s.objects[enemy.id].zone, 'graveyard');
    assert.equal(s.players[1].life, teamwork ? 18 : 20);
    assert.equal(s.objects[bear.id].tapped, teamwork);
  }
});
test('Weftblade may put counters on two opposing creatures rather than narrowing to your creatures', () => {
  let s = fixture();
  const a = put(s, 'Grizzly Bears', 1),
    b = put(s, 'Serra Angel', 1);
  enter(s, 'Weftblade Enhancer');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(a), ref(b)] } });
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 1);
});
test('Sanguine Savior face-up cannot target itself and grants lifelink to another creature', () => {
  let s = fixture();
  const c = put(s, 'Sanguine Savior');
  const b = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'faceUp', { object: c, controller: 0 });
  stabilize(s);
  assert.throws(() => act(s, 'chooseTriggerTarget', { target: ref(c) }));
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  s = resolve(s);
  assert(hasKeyword(s, s.objects[b.id], 'lifelink'));
});
test('Tam Resistance still empowers Jace when choosing no creature target', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const c = put(s, "Tam's Resistance", 0, 'hand');
  s = act(s, 'cast', { card: c.id, targets: { chosen: [] } });
  s = resolve(s);
  const j = Object.values(s.objects).find(
    (o) => o.name === 'Jace Token' && o.zone === 'battlefield',
  );
  assert.equal(j.loyalty, 4);
});
test('Team Tactics grants double strike and adds trample only with teamwork', () => {
  for (const paid of [false, true]) {
    let s = fixture();
    lands(s, 'Mountain', 2);
    const own = put(s, 'Grizzly Bears');
    const target = put(s, 'Serra Angel', 1);
    const c = put(s, 'Team Tactics', 0, 'hand');
    s = act(s, 'cast', {
      card: c.id,
      target: ref(target),
      ...(paid ? { additionalCost: { teamwork: [ref(own)] } } : { additionalCost: null }),
    });
    s = resolve(s);
    assert(hasKeyword(s, s.objects[target.id], 'double strike'));
    assert.equal(hasKeyword(s, s.objects[target.id], 'trample'), paid);
  }
});
test('Repulsor uses the creatures changed controller at resolution rather than its owner', () => {
  let s = fixture();
  lands(s, 'Mountain', 4);
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Serra Angel', 1);
  const c = put(s, 'Repulsor Blast', 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: ref(enemy), additionalCost: { teamwork: [ref(own)] } });
  s.objects[enemy.id].controller = 0;
  s = resolve(s);
  assert.equal(s.players[0].life, 18);
  assert.equal(s.players[1].life, 20);
});
