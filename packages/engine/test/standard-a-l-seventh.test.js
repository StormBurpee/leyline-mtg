import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Edgewall Pack',
  'Lathliss, Dragon Queen',
  'Crossbones, Malicious Mercenary',
  'Aerial Doombot',
  'Brave Brawler',
  'Goblin-town',
  'Cactarantula',
  'Fulminous Forte',
  'Fatehold Chronologist // Peer Review',
  'Campus Composer // Aqueous Aria',
  'Konstrari Improviser // Soul Tether',
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
test('eleven seventh-pass definitions roundtrip including three token-creating prepared spells', () => {
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
test('prepared token spells create exact Cadet, flying blue-red Elemental and Heartwood tokens', () => {
  for (const [name, token] of [
    ['Fatehold Chronologist // Peer Review', 'Cadet'],
    ['Campus Composer // Aqueous Aria', 'Blue Red Flying Elemental Token'],
    ['Konstrari Improviser // Soul Tether', 'Heartwood'],
  ]) {
    let s = rich();
    const r = cast(s, name);
    s = r.s;
    s = resolve(act(s, 'cast', { card: s.objects[r.id].preparedCopy.id }));
    const made = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token);
    assert.equal(made.length, 1);
    assert.equal(made[0].name, token);
    if (token === 'Cadet') assert.equal(s.choice.kind, 'libraryOrder');
    if (token === 'Blue Red Flying Elemental Token') {
      assert.deepEqual(stats(s, made[0]), { power: 3, toughness: 3 });
      assert.ok(keywords(s, made[0]).includes('flying'));
    }
    if (token === 'Heartwood') {
      assert.deepEqual(CARDS.Heartwood.color, ['R', 'G']);
      assert.deepEqual(CARDS.Heartwood.subtypes, ['Heartwood']);
      assert.deepEqual(CARDS.Heartwood.mana, ['R', 'G']);
    }
  }
});
test('power-up puts counters and can only activate once for each source incarnation', () => {
  for (const [name, n] of [
    ['Aerial Doombot', 3],
    ['Brave Brawler', 2],
  ]) {
    let s = rich();
    const r = cast(s, name);
    s = r.s;
    s = resolve(act(s, 'activate', { card: r.id, ability: 0 }));
    assert.equal(s.objects[r.id].plusCounters, n);
    assert.throws(() => act(s, 'activate', { card: r.id, ability: 0 }));
  }
});
test('Lathliss only triggers for other nontoken Dragons and team pump includes token Dragons', () => {
  let s = rich();
  const l = put(s, 'Lathliss, Dragon Queen');
  s = cast(s, 'Shivan Dragon').s;
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.token);
  assert.equal(token.name, 'Five Five Dragon Token');
  s = resolve(act(s, 'activate', { card: l.id, ability: 0 }));
  assert.equal(stats(s, s.objects[token.id]).power, 6);
});
test('Goblin-town sacrifices itself and adds exactly two counters to its target', () => {
  let s = rich();
  const land = put(s, 'Goblin-town'),
    target = put(s, 'Goblin Token');
  s = act(s, 'activate', { card: land.id, ability: 0, target: ref(target) });
  assert.equal(s.objects[land.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 2);
});
