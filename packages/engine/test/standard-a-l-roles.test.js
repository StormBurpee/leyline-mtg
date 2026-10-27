import { move } from '../src/model.js';
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
const names = [
  'Become Brutes',
  'Charmed Clothier',
  'Charming Scoundrel',
  'Cursed Courtier',
  'Cut In',
  'Diminisher Witch',
  'Embereth Veteran',
  'Living Lectern',
  'Besotted Knight // Betroth the Beast',
  'Conceited Witch // Price of Beauty',
  'Ferocious Werefox // Guard Change',
];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('eleven A–L Role cards roundtrip exactly', () => {
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

const roleOn = (s, name, o) =>
  Object.values(s.objects).find(
    (r) =>
      r.zone === 'battlefield' &&
      r.name === name &&
      r.attachedTo?.id === o.id &&
      r.attachedTo?.incarnation === s.objects[o.id].incarnation,
  );
function cast(s, name, args = {}) {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
}
for (const [name, role] of [
  [names[8], 'Royal'],
  [names[9], 'Wicked'],
  [names[10], 'Monster'],
])
  test(`${name} creates correct Role and permits main Adventure face afterward`, () => {
    let s = rich();
    const bear = put(s, 'Grizzly Bears');
    const result = cast(s, name, { mode: 1, target: ref(bear) });
    s = result.s;
    assert.ok(roleOn(s, role, bear));
    assert.equal(stats(s, s.objects[bear.id]).power, 3);
    s = resolve(act(s, 'cast', { card: result.id, mode: 0 }));
    assert.equal(s.objects[result.id].zone, 'battlefield');
  });
test('Become Brutes affects both selected creatures, including an opponent creature', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  s = cast(s, 'Become Brutes', { targets: { chosen: [ref(a), ref(b)] } }).s;
  for (const o of [a, b]) {
    assert.ok(roleOn(s, 'Monster', o));
    assert.equal(stats(s, s.objects[o.id]).power, 3);
    assert.ok(keywords(s, s.objects[o.id]).includes('haste'));
  }
});
test('Clothier excludes itself and binds Role to the announced recipient after source leaves', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears');
  const result = cast(s, 'Charmed Clothier');
  s = result.s;
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(s.objects[result.id]) }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  move(s, s.objects[result.id], 'graveyard');
  s = resolve(s);
  assert.ok(roleOn(s, 'Royal', bear));
});
test('Cursed Courtier creates its self-attached Role but never follows a new incarnation', () => {
  let s = rich();
  let result = cast(s, 'Cursed Courtier');
  s = resolve(result.s);
  assert.ok(roleOn(s, 'Cursed', s.objects[result.id]));
  assert.equal(stats(s, s.objects[result.id]).power, 1);
  s = rich();
  result = cast(s, 'Cursed Courtier');
  s = result.s;
  move(s, s.objects[result.id], 'exile');
  enterBattlefield(s, s.objects[result.id], 0);
  // Remove the new entry trigger to isolate the original stale source reference.
  s.pendingTriggers = [];
  s = resolve(s);
  assert.equal(roleOn(s, 'Cursed', s.objects[result.id]), undefined);
});
test('Cut In deals four damage and creates Young Hero on its independent optional target', () => {
  let s = rich();
  const victim = put(s, 'Serra Angel', 1),
    hero = put(s, 'Grizzly Bears');
  s = cast(s, 'Cut In', { targets: { victim: [ref(victim)], hero: [ref(hero)] } }).s;
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.ok(roleOn(s, 'Young Hero', hero));
});
test('Diminisher Witch triggers only when bargained and curses the opposing creature', () => {
  let s = rich();
  let result = cast(s, 'Diminisher Witch');
  assert.equal(result.s.stack.length, 0);
  s = rich();
  const food = put(s, 'Food Token'),
    victim = put(s, 'Serra Angel', 1);
  result = cast(s, 'Diminisher Witch', { mode: 1, sacrifice: ref(food) });
  s = result.s;
  s = act(s, 'chooseTriggerTarget', { target: ref(victim) });
  s = resolve(s);
  assert.ok(roleOn(s, 'Cursed', victim));
  assert.equal(stats(s, s.objects[victim.id]).power, 1);
});
test('Embereth Veteran creates Young Hero after paying its self sacrifice', () => {
  let s = rich();
  const source = put(s, 'Embereth Veteran'),
    bear = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, target: ref(bear) }));
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.ok(roleOn(s, 'Young Hero', bear));
});
test('Living Lectern draws with zero targets or creates Sorcerer on a chosen other creature', () => {
  for (const choose of [false, true]) {
    let s = rich();
    const source = put(s, 'Living Lectern'),
      bear = put(s, 'Grizzly Bears');
    const hand = s.players[0].hand.length;
    s = resolve(
      act(s, 'activate', {
        card: source.id,
        ability: 0,
        targets: { recipient: choose ? [ref(bear)] : [] },
      }),
    );
    assert.equal(s.players[0].hand.length, hand + 1);
    assert.equal(!!roleOn(s, 'Sorcerer', bear), choose);
  }
});
test('Charming Scoundrel Role mode uses announcement-time mode and target selection', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears');
  s = cast(s, 'Charming Scoundrel').s;
  s = act(s, 'chooseTriggerMode', { mode: 2 });
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  s = resolve(s);
  assert.ok(roleOn(s, 'Wicked', bear));
});
test('Become Brutes does not attach to a blinked target when the other target remains legal', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  const spell = put(s, 'Become Brutes', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [ref(a), ref(b)] } });
  move(s, s.objects[a.id], 'exile');
  enterBattlefield(s, s.objects[a.id], 0);
  s = resolve(s);
  assert.equal(roleOn(s, 'Monster', a), undefined);
  assert.ok(roleOn(s, 'Monster', b));
});
test('Charming Scoundrel Treasure and discard-then-draw modes retain their separate effects', () => {
  let s = rich();
  s = cast(s, 'Charming Scoundrel').s;
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  s = resolve(s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Treasure Token').length, 1);
  s = rich();
  s = cast(s, 'Charming Scoundrel').s;
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = resolve(s);
  // Empty hand cannot discard, but the following draw still happens.
  assert.equal(s.players[0].hand.length, 1);
});
