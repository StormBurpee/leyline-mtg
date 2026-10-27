import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { move } from '../src/model.js';
import { stabilize, canGainLife } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Driver of the Dead',
  "Alania's Pathmaker",
  'Gundabad Opportunist',
  'Kulrath Mystic',
  "Hazel's Nocturne",
  'Balmor, Battlemage Captain',
  'Cycle of Renewal',
  'Linden, the Steadfast Queen',
  'Al Bhed Salvagers',
  'Guerrilla Gorilla',
  'Agent of Kotis',
  'Giant Cindermaw',
  'Guy in the Chair',
  "Heroes' Bane",
  'Dragonmaster Outcast',
  'Kiora of Fire and Ashes',
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
test('16 additional A–L sources roundtrip including exact token identities', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const source = sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName });
    const result = compileCard(source, { identities: CARD_IDS });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
test('Heroes Bane enters with four counters and uses effective power at resolution', () => {
  let s = rich();
  let r = cast(s, "Heroes' Bane");
  s = r.s;
  assert.equal(s.objects[r.id].plusCounters, 4);
  s = act(s, 'activate', { card: r.id, ability: 0 });
  s.objects[r.id].plusCounters = 6;
  s = resolve(s);
  assert.equal(s.objects[r.id].plusCounters, 12);
});
test('Driver of the Dead returns a targeted small creature without returning itself', () => {
  let s = rich();
  const v = put(s, 'Llanowar Elves', 0, 'graveyard'),
    driver = put(s, 'Driver of the Dead');
  move(s, driver, 'graveyard');
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(v) });
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'battlefield');
  assert.equal(s.objects[driver.id].zone, 'graveyard');
});
test('Hazels Nocturne can choose no cards while still draining opponent', () => {
  let s = rich();
  s = cast(s, "Hazel's Nocturne", { targets: { chosen: [] } }).s;
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});
test('Balmor modifies all current friendly creatures and does not grant enemy trample', () => {
  let s = rich();
  const b = put(s, 'Balmor, Battlemage Captain'),
    friend = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(stats(s, s.objects[friend.id]).power, 3);
  assert.ok(keywords(s, s.objects[friend.id]).includes('trample'));
  assert.equal(stats(s, s.objects[enemy.id]).power, 2);
});
test('Giant Cindermaw prevents both players life gain while present', () => {
  const s = fixture();
  const o = put(s, 'Giant Cindermaw');
  assert.equal(canGainLife(s), false);
  move(s, o, 'graveyard');
  assert.equal(canGainLife(s), true);
});
test('Agent of Kotis exiles as a sorcery-speed cost then puts two counters on target', () => {
  let s = rich();
  const a = put(s, 'Agent of Kotis', 0, 'graveyard'),
    target = put(s, 'Grizzly Bears', 1);
  s = act(s, 'activate', { card: a.id, ability: 0, target: ref(target) });
  assert.equal(s.objects[a.id].zone, 'exile');
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 2);
});
test('Kiora entry and activation make exact red 5/5 flying Dragons', () => {
  let s = rich();
  const r = cast(s, 'Kiora of Fire and Ashes');
  s = resolve(r.s);
  s = resolve(act(s, 'activate', { card: r.id, ability: 0 }));
  const tokens = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token);
  assert.equal(tokens.length, 2);
  for (const o of tokens) {
    assert.deepEqual(stats(s, o), { power: 5, toughness: 5 });
    assert.ok(keywords(s, o).includes('flying'));
  }
});
test('Cycle of Renewal sacrifices on resolution then permits finding zero or two basic lands', () => {
  for (const count of [0, 2]) {
    let s = rich();
    const land = put(s, 'Forest');
    const a = put(s, 'Plains', 0, 'library'),
      b = put(s, 'Swamp', 0, 'library');
    s = cast(s, 'Cycle of Renewal').s;
    assert.equal(s.choice.kind, 'sacrifice');
    s = act(s, 'sacrifice', { cards: [land.id] });
    assert.equal(s.objects[land.id].zone, 'graveyard');
    assert.equal(s.choice.kind, 'librarySearch');
    s = act(s, 'searchLibrary', { cards: [a.id, b.id].slice(0, count) });
    for (const id of [a.id, b.id]) {
      assert.equal(s.objects[id].zone, count ? 'battlefield' : 'library');
      if (count) assert.equal(s.objects[id].tapped, true);
    }
  }
});
test('Dragonmaster Outcast rechecks six-land threshold on resolution', () => {
  for (const lose of [false, true]) {
    let s = fixture();
    put(s, 'Dragonmaster Outcast');
    const lands = Array.from({ length: 6 }, () => put(s, 'Forest'));
    s.step = 'untap';
    advanceStep(s);
    stabilize(s);
    assert.equal(s.stack.length, 1);
    if (lose) move(s, lands[0], 'graveyard');
    s = resolve(s);
    assert.equal(
      Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token).length,
      lose ? 0 : 1,
    );
  }
});
