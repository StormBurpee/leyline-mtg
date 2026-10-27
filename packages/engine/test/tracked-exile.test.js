import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { resolveEffects } from '../src/effects.js';
import { definition, stats, keywords, move, ref } from '../src/model.js';
import { legalActions } from '../src/index.js';
function exile(s, source, card) {
  resolveEffects(s, {
    controller: source.controller,
    source: ref(source),
    target: ref(card),
    effects: [{ op: 'moveTarget', destination: 'exile', trackSource: true }],
  });
}
test('Curator counts distinct types among currently tracked exile cards and loses bonus when one moves', () => {
  const s = fixture(),
    curator = put(s, 'Keen-Eyed Curator');
  for (const name of ['Forest', 'Llanowar Elves', 'Shock'])
    exile(s, curator, put(s, name, 1, 'graveyard'));
  assert.equal(stats(s, curator).power, 3);
  const artifact = put(s, 'Torpor Orb', 1, 'graveyard');
  exile(s, curator, artifact);
  assert.equal(stats(s, curator).power, 7);
  assert.ok(keywords(s, curator).includes('trample'));
  move(s, artifact, 'graveyard');
  assert.equal(stats(s, curator).power, 3);
  move(s, artifact, 'exile');
  assert.equal(stats(s, curator).power, 3);
});
test('Pit mana sees union of tracked colors, colorless is not a color, leaves and reentry clears links', () => {
  const s = fixture(),
    pit = put(s, 'Pit of Offerings');
  exile(s, pit, put(s, 'Shock', 1, 'graveyard'));
  exile(s, pit, put(s, 'Llanowar Elves', 0, 'graveyard'));
  exile(s, pit, put(s, 'Torpor Orb', 0, 'graveyard'));
  assert.deepEqual(new Set(definition(s, pit).mana), new Set(['C', 'R', 'G']));
  assert.ok(
    legalActions(s, 0).some((a) => a.type === 'tapMana' && a.card === pit.id && a.color === 'R'),
  );
  move(s, pit, 'hand');
  move(s, pit, 'battlefield');
  assert.deepEqual(definition(s, pit).mana, ['C']);
});
test('old source ability still exiles but cannot attach tracking to a returned source', () => {
  const s = fixture(),
    source = put(s, 'Keen-Eyed Curator'),
    card = put(s, 'Forest', 1, 'graveyard');
  const entry = {
    controller: 0,
    source: ref(source),
    target: ref(card),
    effects: [{ op: 'moveTarget', destination: 'exile', trackSource: true }],
  };
  move(s, source, 'hand');
  move(s, source, 'battlefield');
  resolveEffects(s, entry);
  assert.equal(card.zone, 'exile');
  assert.equal(source.trackedExile, undefined);
});
