import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put } from './helpers.js';
import { move, captureDepartureContext } from '../src/model.js';
test('Rest in Peace replaces its own departure and every simultaneous death regardless of move order', () => {
  const s = fixture(),
    rip = put(s, 'Rest in Peace'),
    victim = put(s, 'Llanowar Elves');
  const ctx = captureDepartureContext(s);
  move(s, rip, 'graveyard', ctx);
  move(s, victim, 'graveyard', ctx);
  assert.equal(rip.zone, 'exile');
  assert.equal(victim.zone, 'exile');
  const after = put(s, 'Llanowar Elves');
  move(s, after, 'graveyard');
  assert.equal(after.zone, 'graveyard');
});
test('Rest in Peace replaces graveyard moves from hand, library and exile, including tokens', () => {
  const s = fixture();
  put(s, 'Rest in Peace');
  for (const zone of ['hand', 'library', 'exile']) {
    const o = put(s, 'Island', 0, zone);
    move(s, o, 'graveyard');
    assert.equal(o.zone, 'exile');
  }
  const token = put(s, 'Blue Fish Token');
  move(s, token, 'graveyard');
  assert.equal(token.zone, 'exile');
});
