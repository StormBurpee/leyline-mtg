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
const names = ['Reef Roads', 'Rocky Roads', 'Wild Roads'];
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
test('3 complete v53 Roads cards compile and round trip every clause', () => {
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
import { crewPlan, saddlePlan, tapPower } from '../packages/engine/src/index.js';
for (const [name, basic, color] of [
  ['Reef Roads', 'Island', 'U'],
  ['Rocky Roads', 'Mountain', 'R'],
  ['Wild Roads', 'Forest', 'G'],
]) {
  test(name + ' enters tapped without a friendly Mount or Vehicle', () => {
    const s = fixture();
    put(s, 'Bounding Felidar', 1);
    assert.equal(enter(s, name).tapped, true);
    const own = fixture();
    put(own, 'Bounding Felidar');
    assert.equal(enter(own, name).tapped, false);
    const vehicle = fixture();
    put(vehicle, 'Clamorous Ironclad');
    assert.equal(enter(vehicle, name).tapped, false);
  });
  test(
    name + ' sacrifices at sorcery speed for an exact 1/1 Pilot with cost-only power bonus',
    () => {
      let s = fixture();
      const mount = put(s, 'Bounding Felidar');
      const road = enter(s, name);
      lands(s, basic, 2);
      const a = legalActions(s, 0).find((a) => a.type === 'activate' && a.card === road.id);
      assert(a);
      s = act(s, 'activate', { card: road.id, ability: a.ability });
      assert.equal(s.objects[road.id].zone, 'graveyard');
      s = resolve(s);
      const pilot = Object.values(s.objects).find(
        (o) => o.name === 'Pilot Token' && o.zone === 'battlefield',
      );
      assert(pilot);
      assert.equal(stats(s, pilot).power, 1);
      assert.equal(tapPower(s, pilot, mount.id, 'saddle'), 3);
      assert(saddlePlan(s, 0, mount.id).includes(pilot.id));
    },
  );
}
