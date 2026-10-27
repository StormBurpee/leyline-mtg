import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = ['Country Roads', 'Foul Roads', 'Defend the Rider'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('three Pilot support cards roundtrip exactly', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
for (const name of names.slice(0, 2)) {
  test(`${name} enters tapped unless a Mount or Vehicle is controlled`, () => {
    for (const support of [null, 'Alacrian Jaguar', 'Broadcast Rambler']) {
      const s = rich();
      if (support) put(s, support, 0);
      const land = put(s, name, 0, 'hand');
      enterBattlefield(s, land, 0);
      assert.equal(land.tapped, !support);
    }
  });
  test(`${name} sacrifices itself to create the exact Pilot token`, () => {
    let s = rich();
    const land = put(s, name, 0);
    s = act(s, 'activate', { card: land.id, ability: 0 });
    assert.equal(s.objects[land.id].zone, 'graveyard');
    s = resolve(s);
    const pilot = Object.values(s.objects).find((o) => o.name === 'Pilot Token');
    assert.ok(pilot);
    assert.equal(stats(s, pilot).power, 1);
    assert.equal(CARDS['Pilot Token'].crewSaddlePowerBonus, 2);
  });
}
test('Defend the Rider protects any controlled permanent or creates the Pilot', () => {
  let s = rich();
  const land = put(s, 'Forest', 0);
  let spell = put(s, 'Defend the Rider', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, mode: 0, target: ref(land) }));
  assert.ok(keywords(s, s.objects[land.id]).includes('hexproof'));
  assert.ok(keywords(s, s.objects[land.id]).includes('indestructible'));
  s = rich();
  spell = put(s, 'Defend the Rider', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, mode: 1 }));
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Pilot Token').length, 1);
});
