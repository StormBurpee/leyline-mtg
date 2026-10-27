import test from 'node:test';
import assert from 'node:assert/strict';
import { untapObject, move, ref } from '../src/model.js';
import { resolveEffects } from '../src/effects.js';
import { nextTurn } from '../src/turn.js';
import { fixture, put } from './helpers.js';
test('stun consumes one counter per actual untap, including explicit untaps', () => {
  const s = fixture(),
    o = put(s, 'Grizzly Bears');
  o.stunCounters = 2;
  assert.equal(untapObject(s, o), false);
  assert.equal(o.stunCounters, 2);
  o.tapped = true;
  resolveEffects(s, { controller: 0, source: ref(o), target: ref(o), effects: [{ op: 'untap' }] });
  assert.equal(o.tapped, true);
  assert.equal(o.stunCounters, 1);
  assert.equal(untapObject(s, o), false);
  assert.equal(o.stunCounters, 0);
  assert.equal(untapObject(s, o), true);
});
test('normal untap respects stun, but a no-untap aura does not consume counters', () => {
  const s = fixture(),
    o = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Charmed Sleep');
  aura.attachedTo = ref(o);
  o.stunCounters = 2;
  o.tapped = true;
  nextTurn(s);
  assert.equal(o.stunCounters, 2);
  assert.equal(o.tapped, true);
  move(s, aura, 'graveyard');
  nextTurn(s);
  nextTurn(s);
  assert.equal(o.stunCounters, 1);
  assert.equal(o.tapped, true);
  move(s, o, 'hand');
  assert.equal(o.stunCounters, undefined);
});

import { act, lands, resolve } from './helpers.js';
import { chooseBotCommand } from '../src/index.js';
test('Sleep-Cursed Faerie enters with stun counters and its ability removes one per activation', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const card = put(s, 'Sleep-Cursed Faerie', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.objects[card.id].stunCounters, 3);
  assert.equal(s.objects[card.id].tapped, true);
  s = act(s, 'activate', { card: card.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[card.id].stunCounters, 2);
  assert.equal(s.objects[card.id].tapped, true);
});
test('grouped stun chooses two creatures and counts independently', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const spell = put(s, 'Succumb to the Cold', 0, 'hand');
  const a = put(s, 'Grizzly Bears', 1),
    b = put(s, 'Grizzly Bears', 1);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.card, spell.id);
  assert.equal(command.targets.creatures.length, 2);
  s = act(s, 'cast', command);
  s = resolve(s);
  for (const target of [a, b]) {
    assert.equal(s.objects[target.id].tapped, true);
    assert.equal(s.objects[target.id].stunCounters, 1);
  }
});
