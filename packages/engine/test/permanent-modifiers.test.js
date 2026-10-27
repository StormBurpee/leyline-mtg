import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, definition, ref } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';

test('permanent-targeted P/T effects do not incorrectly require a creature at casting', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Permanent modifier fixture': {
      name: 'Permanent modifier fixture',
      type: 'instant',
      cost: {},
      target: 'permanent',
      effects: [{ op: 'modify', power: 2, toughness: 2 }],
    },
  });
  const spell = put(s, 'Permanent modifier fixture', 0, 'hand'),
    artifact = put(s, 'Short Bow');
  s = act(s, 'cast', { card: spell.id, target: ref(artifact) });
  s = resolve(s);
  assert.equal(definition(s, s.objects[artifact.id]).type, 'artifact');
  assert.equal(s.modifiers.filter((m) => m.objectId === artifact.id).length, 1);
  assert.equal(s.objects[artifact.id].zone, 'battlefield');
});
test('subtype-only creature buffs remain legal without narrowing their printed selectors', () => {
  const d = CARDS['Ezekiel Sims, Spider-Totem'];
  assert.equal(d.triggers[0].target.scope, 'permanent');
  assert.ok(JSON.stringify(d.triggers[0].target.where).includes('Spider'));
  assert.equal(JSON.stringify(d.triggers[0].target.where).includes('"type":"creature"'), false);
});
