import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords, dispatch } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = ["Grabby Giant // That's Mine", 'Hollow Scavenger // Bakery Raid'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('two sacrifice Adventures roundtrip exactly', () => {
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

for (const [name, token] of [
  [names[0], 'Treasure Token'],
  [names[1], 'Food Token'],
])
  test(`${name} Adventure supplies a token its creature may sacrifice`, () => {
    let s = rich();
    const card = put(s, name, 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id, mode: 1 }));
    const victim = Object.values(s.objects).find((o) => o.name === token);
    assert.ok(victim);
    s = resolve(act(s, 'cast', { card: card.id, mode: 0 }));
    const base = stats(s, s.objects[card.id]).power,
      hand = s.players[0].hand.length;
    s = resolve(act(s, 'activate', { card: card.id, ability: 0, sacrifices: [ref(victim)] }));
    if (name === names[0]) assert.equal(s.players[0].hand.length, hand + 1);
    else {
      assert.equal(stats(s, s.objects[card.id]).power, base + 2);
      const second = put(s, 'Food Token');
      assert.equal(
        dispatch(s, {
          type: 'activate',
          player: 0,
          card: card.id,
          ability: 0,
          sacrifices: [ref(second)],
        }).ok,
        false,
      );
    }
  });
test('Grabby Giant may sacrifice a land as well as an artifact', () => {
  let s = rich();
  const giant = put(s, names[0]),
    land = put(s, 'Forest');
  const hand = s.players[0].hand.length;
  s = resolve(act(s, 'activate', { card: giant.id, ability: 0, sacrifices: [ref(land)] }));
  assert.equal(s.objects[land.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, hand + 1);
});
