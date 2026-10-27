import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Boundary Lands Ranger',
  'Bulk Up',
  'Bloombrute',
  'Frontline Rush',
  'Beetle, Legacy Criminal',
  'Ancestral Anger',
  'Cerebral Confiscation',
  'Brineborn Cutthroat',
  'Dream Spoilers',
  'Giott, King of the Dwarves',
  "Assassin's Trophy",
];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('eleven fifth-batch cards roundtrip with exact token identities', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
test('Assassins Trophy gives the destroyed permanent controller the optional basic search', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears', 1),
    land = put(s, 'Swamp', 1, 'library');
  s = cast(s, "Assassin's Trophy", { target: ref(target) }).s;
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.optional, true);
  s = act(s, 'searchLibrary', { cards: [land.id] });
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].tapped, false);
});
test('Ancestral Anger counts same-named graveyard cards and draws after buff', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears');
  put(s, 'Ancestral Anger', 0, 'graveyard');
  put(s, 'Ancestral Anger', 0, 'graveyard');
  put(s, 'Ancestral Anger', 1, 'graveyard');
  s = cast(s, 'Ancestral Anger', { target: ref(target) }).s;
  assert.equal(stats(s, s.objects[target.id]).power, 5);
  assert.equal(s.players[0].hand.length, 1);
});
test('Bulk Up doubles current power but leaves toughness unchanged', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears');
  target.plusCounters = 1;
  s = cast(s, 'Bulk Up', { target: ref(target) }).s;
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 6, toughness: 3 });
});
test('Boundary Lands Ranger sees current four-power creatures and offers optional discard', () => {
  let s = rich();
  put(s, 'Boundary Lands Ranger');
  const b = put(s, 'Grizzly Bears');
  b.plusCounters = 2;
  put(s, 'Forest', 0, 'hand');
  advanceStep(s);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.optional, true);
});
test('Beetle renew leaves a plus counter and grants flying for the turn', () => {
  let s = rich();
  const a = put(s, 'Beetle, Legacy Criminal', 0, 'graveyard'),
    b = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: a.id, ability: 0, target: ref(b) }));
  assert.equal(s.objects[a.id].zone, 'exile');
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.ok(keywords(s, s.objects[b.id]).includes('flying'));
});
