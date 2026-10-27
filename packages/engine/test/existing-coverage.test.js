import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, ref, stats, dispatch } from '../src/index.js';
import { battlefield, definition, move } from '../src/model.js';
import { enterBattlefield } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';
const rich = () => {
  const s = fixture();
  for (const symbol of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[symbol] = 100;
  return s;
};
const play = (s, name, fields = {}) => {
  const o = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: o.id, ...fields });
  return { s: resolve(s), id: o.id };
};
test('life-threshold dual lands consider either player and the exact thirteen boundary', () => {
  for (const life of [12, 13, 14])
    for (const player of [0, 1]) {
      let s = fixture();
      s.players[player].life = life;
      const land = put(s, 'Abandoned Campground', 0, 'hand');
      s = act(s, 'playLand', { card: land.id });
      assert.equal(s.objects[land.id].tapped, life > 13);
    }
});
test('fastlands count only other lands before entering', () => {
  for (const count of [0, 1, 2, 3]) {
    let s = fixture();
    for (let i = 0; i < count; i++) put(s, 'Forest');
    const land = put(s, 'Blooming Marsh', 0, 'hand');
    s = act(s, 'playLand', { card: land.id });
    assert.equal(s.objects[land.id].tapped, count > 2);
  }
});
test('zero-target return spell still gains life and two-target returns use exact graveyard references', () => {
  let s = rich();
  s = play(s, 'Pull from the Grave', { targets: { chosen: [] } }).s;
  assert.equal(s.players[0].life, 22);
  const a = put(s, 'Grizzly Bears', 0, 'graveyard'),
    b = put(s, 'Llanowar Elves', 0, 'graveyard');
  s = play(s, 'Fight On!', { targets: { chosen: [ref(a), ref(b)] } }).s;
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('Calamitous Tide preserves draw-then-discard continuation after optional bounces', () => {
  let s = rich();
  const foe = put(s, 'Grizzly Bears', 1);
  s = play(s, 'Calamitous Tide', { targets: { chosen: [ref(foe)] } }).s;
  assert.equal(s.objects[foe.id].zone, 'hand');
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.players[0].hand.length, 1);
});
test('Glimmerburst draws two and creates an enchantment creature, not a plain creature token', () => {
  let s = rich();
  s = play(s, 'Glimmerburst').s;
  const token = battlefield(s).find((o) => o.token);
  assert.deepEqual(definition(s, token).types, ['enchantment', 'creature']);
  assert.equal(stats(s, token).power, 1);
  assert.equal(s.players[0].hand.length, 2);
});
test('token makers preserve the separate one-one and two-two Robot definitions', () => {
  let s = rich();
  let cast = play(s, 'Mechanized Ninja Cavalry');
  s = resolve(cast.s);
  const small = battlefield(s).find((o) => o.token);
  assert.equal(stats(s, small).power, 1);
  const large = put(s, 'Gravpack Monoist');
  move(s, large, 'graveyard');
  s = act(s, 'pass');
  s = resolve(s);
  const robots = battlefield(s).filter((o) => o.token);
  assert.equal(robots.length, 2);
  assert.ok(robots.some((o) => stats(s, o).power === 2 && o.tapped));
});
test('Web-Warriors counters every other friendly creature but not itself or opposing creatures', () => {
  let s = rich();
  const friend = put(s, 'Grizzly Bears'),
    foe = put(s, 'Grizzly Bears', 1);
  const cast = play(s, 'Web-Warriors');
  s = resolve(cast.s);
  assert.equal(s.objects[friend.id].plusCounters, 1);
  assert.equal(s.objects[foe.id].plusCounters, 0);
  assert.equal(s.objects[cast.id].plusCounters, 0);
});
test('Mary Jane draws at most once each turn for Spider entries, including changelings', () => {
  const s = fixture();
  const watcher = put(s, 'Mary Jane Watson');
  for (let i = 0; i < 2; i++) {
    const spider = put(s, 'Chitinous Graspling', 0, 'hand');
    enterBattlefield(s, spider);
  }
  assert.equal(s.pendingTriggers.filter((t) => t.name === watcher.name).length, 1);
  s.turn++;
  const spider = put(s, 'Chitinous Graspling', 0, 'hand');
  enterBattlefield(s, spider);
  assert.equal(s.pendingTriggers.filter((t) => t.name === watcher.name).length, 2);
});
test('Exorcise accepts artifacts, enchantments or sufficiently powerful creatures without narrowing Oracle', () => {
  let s = rich();
  const artifact = put(s, 'Basilisk Collar', 1);
  s = play(s, 'Exorcise', { target: ref(artifact) }).s;
  assert.equal(s.objects[artifact.id].zone, 'exile');
  const small = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Exorcise', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(small) }).ok,
    false,
  );
  small.plusCounters = 2;
  s = act(s, 'cast', { card: spell.id, target: ref(small) });
  s = resolve(s);
  assert.equal(s.objects[small.id].zone, 'exile');
});
test('Kraven activation keeps once-per-turn usage and correct temporary bonus', () => {
  let s = rich();
  const cat = put(s, "Kraven's Cats");
  s = act(s, 'activate', { card: cat.id, ability: 0 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[cat.id]).power, CARDS[cat.name].power + 2);
  assert.equal(dispatch(s, { type: 'activate', player: 0, card: cat.id, ability: 0 }).ok, false);
});
test('Friendly Teddy gives both players a card when it dies', () => {
  let s = fixture();
  const teddy = put(s, 'Friendly Teddy');
  move(s, teddy, 'graveyard');
  s = act(s, 'pass');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[1].hand.length, 1);
});
test('Rapturous Moment adds its exact mana after the discard choice completes', () => {
  let s = rich();
  s = play(s, 'Rapturous Moment').s;
  assert.equal(s.choice.kind, 'discardEffect');
  const beforeU = s.players[0].mana.U,
    beforeR = s.players[0].mana.R;
  s = act(s, 'discardEffect', { cards: s.players[0].hand.slice(0, 2) });
  assert.equal(s.players[0].mana.U, beforeU + 2);
  assert.equal(s.players[0].mana.R, beforeR + 3);
  assert.equal(s.players[0].hand.length, 1);
});
test('mana-value cast watchers distinguish four and five without requiring a creature spell', () => {
  for (const [name, expected] of [
    ['Glimmerburst', 1],
    ['Preposterous Proportions', 2],
  ]) {
    let s = rich();
    const tanufel = put(s, 'Tanufel Rimespeaker'),
      prowler = put(s, 'Stormkeld Prowler');
    const spell = put(s, name, 0, 'hand');
    s = act(s, 'cast', { card: spell.id });
    const entries = [...s.stack, ...(s.choice?.entries ?? [])];
    assert.equal(entries.filter((t) => t.name === tanufel.name).length, 1);
    assert.equal(entries.filter((t) => t.name === prowler.name).length, expected - 1);
  }
});
