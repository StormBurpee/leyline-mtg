import test from 'node:test';
import { readFileSync } from 'node:fs';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
import { notifyTriggers, move } from '../src/model.js';
const names = ['Kishla Village', 'Channeled Dragonfire', 'Haunted Hellride', "Archenemy's Charm"];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('four eighteenth-pass cards roundtrip exactly', () => {
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

test('Kishla checks Island or Swamp and its tap activation surveils two', () => {
  for (const basic of [null, 'Forest', 'Island', 'Swamp']) {
    let s = rich();
    if (basic) put(s, basic);
    const l = put(s, 'Kishla Village', 0, 'hand');
    enterBattlefield(s, l, 0);
    stabilize(s);
    assert.equal(l.tapped, basic !== 'Island' && basic !== 'Swamp');
  }
  let s = rich();
  const l = put(s, 'Kishla Village');
  s = resolve(act(s, 'activate', { card: l.id, ability: 0 }));
  assert.equal(s.choice.cards.length, 2);
});
test('Channeled Dragonfire harmonizes from the graveyard and exiles after damage', () => {
  let s = rich();
  const spell = put(s, 'Channeled Dragonfire', 0, 'graveyard'),
    a = put(s, 'Grizzly Bears');
  s = resolve(
    act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 }, harmonize: ref(a) }),
  );
  assert.equal(s.players[1].life, 18);
  assert.equal(s.objects[a.id].tapped, true);
  assert.equal(s.objects[spell.id].zone, 'exile');
});
test('Archenemy charm returns up to two creatures or planeswalkers with exact grouped targets', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears', 0, 'graveyard'),
    b = put(s, 'Ajani, Caller of the Pride', 0, 'graveyard');
  s = cast(s, "Archenemy's Charm", { mode: 1, targets: { chosen: [ref(a), ref(b)] } }).s;
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('Haunted Hellride triggers once per attacking group and untaps its selected creature', () => {
  let s = rich();
  put(s, 'Haunted Hellride');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  s = act(s, 'chooseTriggerTarget', { target: ref(a) });
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[a.id].tapped, false);
  assert.equal(stats(s, s.objects[a.id]).power, 3);
  assert.ok(keywords(s, s.objects[a.id]).includes('deathtouch'));
  assert.equal(s.objects[b.id].tapped, true);
});
