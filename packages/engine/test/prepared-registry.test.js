import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/registry.js';
const token = {
  name: 'Prepared Test Token',
  type: 'creature',
  cost: {},
  power: 2,
  toughness: 2,
  token: true,
};
const scholar = {
  name: 'Prepared Test Scholar // Summon',
  type: 'creature',
  cost: { U: 1 },
  power: 1,
  toughness: 1,
  mainName: 'Prepared Test Scholar',
  entersPrepared: true,
  prepareSpell: {
    name: 'Summon',
    type: 'sorcery',
    cost: { W: 1 },
    effects: [{ op: 'token', definition: token.name, count: 1 }],
  },
};
test('prepared token spells validate references against the enclosing registry in either declaration order', () => {
  for (const input of [
    [scholar, token],
    [token, scholar],
  ]) {
    const registry = createRegistry(input),
      spell = registry[scholar.name].prepareSpell;
    assert.deepEqual(spell.types, ['sorcery']);
    assert.deepEqual(spell.keywords, []);
    assert.deepEqual(spell.subtypes, []);
    assert.deepEqual(spell.color, ['W']);
    assert.equal(spell.text, '');
    assert(Object.isFrozen(spell));
    assert(Object.isFrozen(spell.effects));
    assert.deepEqual(spell.effects, [{ op: 'token', definition: token.name, count: 1 }]);
  }
});
test('prepared token references still fail closed when the token is absent or not a token', () => {
  assert.throws(() => createRegistry([scholar]), /missing token definition Prepared Test Token/);
  assert.throws(
    () => createRegistry([scholar, { ...token, token: false }]),
    /missing token definition Prepared Test Token/,
  );
});
test('prepared nested-definition validation rejects invalid effects and forbidden further nesting', () => {
  const badEffect = structuredClone(scholar);
  badEffect.prepareSpell.effects = [{ op: 'notARealEffect' }];
  assert.throws(() => createRegistry([badEffect, token]), /prepareSpell/);
  const nested = structuredClone(scholar);
  nested.prepareSpell.prepareSpell = structuredClone(scholar.prepareSpell);
  assert.throws(() => createRegistry([nested, token]), /nonnested instant or sorcery/);
});
