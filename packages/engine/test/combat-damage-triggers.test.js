import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref } from '../src/index.js';
import { dealDamage, dealDamageBatch, stabilize } from '../src/effects.js';
import { fixture, put, resolve, act } from './helpers.js';
function setup(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Damage witness': {
      name: 'Damage witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 3,
      triggers: [
        {
          event: { event: 'combatDamagePlayer', object: 'source' },
          effects: [{ op: 'drawEventAmount' }],
        },
      ],
      ...extra,
    },
  });
  return s;
}
const source = (s, o) => ({
  ...ref(o),
  controller: o.controller,
  definition: s.catalog[o.name],
  keywords: s.catalog[o.name].keywords,
});
test('combat player damage records the amount and resolves drawing through the stack', () => {
  let s = setup();
  const o = put(s, 'Damage witness');
  dealDamageBatch(
    s,
    [{ source: source(s, o), target: { kind: 'player', id: 1 }, amount: 3 }],
    true,
  );
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.pendingTriggers[0].eventAmount, 3);
  const before = s.players[0].hand.length;
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 3);
});
test('noncombat damage, creature damage and zero damage do not trigger player combat damage', () => {
  const s = setup(),
    o = put(s, 'Damage witness'),
    victim = put(s, 'Grizzly Bears', 1);
  dealDamage(s, source(s, o), { kind: 'player', id: 1 }, 2, false);
  dealDamage(s, source(s, o), ref(victim), 1, true);
  dealDamage(s, source(s, o), { kind: 'player', id: 1 }, 0, true);
  assert.equal(s.pendingTriggers.length, 0);
});
test('simultaneous combat triggers see all lifelink gains before condition checks', () => {
  const s = setup({
    keywords: ['lifelink'],
    triggers: [
      {
        event: { event: 'combatDamagePlayer', object: 'source' },
        condition: {
          kind: 'compare',
          left: { kind: 'life', player: 'you' },
          right: 25,
          operator: 'gte',
        },
        effects: [{ op: 'draw', count: 1 }],
      },
    ],
  });
  const a = put(s, 'Damage witness'),
    b = put(s, 'Damage witness');
  dealDamageBatch(
    s,
    [a, b].map((o) => ({ source: source(s, o), target: { kind: 'player', id: 1 }, amount: 3 })),
    true,
  );
  assert.equal(s.players[0].life, 26);
  assert.equal(s.pendingTriggers.length, 2);
});

import { chooseBotCommand } from '../src/index.js';
test('optional damage-sized drawing is declined when its recorded amount would empty the library', () => {
  let s = setup({
    triggers: [
      {
        event: { event: 'combatDamagePlayer', object: 'source' },
        optional: true,
        effects: [{ op: 'drawEventAmount' }],
      },
    ],
  });
  const o = put(s, 'Damage witness');
  dealDamage(s, source(s, o), { kind: 'player', id: 1 }, 100, true);
  // Keep the opponent alive so the optional resolution can be inspected.
  s.players[1].life = 20;
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  assert.equal(chooseBotCommand(s, 0).accept, false);
});

test('Koma creates four correctly named coils from one player hit', () => {
  let s = fixture();
  const koma = put(s, 'Koma, World-Eater');
  dealDamageBatch(
    s,
    [{ source: source(s, koma), target: { kind: 'player', id: 1 }, amount: 1 }],
    true,
  );
  stabilize(s);
  s = resolve(s);
  const coils = Object.values(s.objects).filter(
    (o) => o.name === "Koma's Coil" && o.zone === 'battlefield',
  );
  assert.equal(coils.length, 4);
  for (const coil of coils) {
    assert.equal(s.catalog[coil.name].power, 3);
    assert.equal(s.catalog[coil.name].toughness, 3);
  }
});
test('Dragon Mage finishes both discards before either seven-card draw', () => {
  let s = fixture();
  const mage = put(s, 'Dragon Mage');
  put(s, 'Forest', 0, 'hand');
  put(s, 'Island', 0, 'hand');
  put(s, 'Mountain', 1, 'hand');
  dealDamage(s, source(s, mage), { kind: 'player', id: 1 }, 1, true);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.player, 0);
  s = act(s, 'discardEffect', { cards: [...s.players[0].hand] });
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.choice.player, 1);
  s = act(s, 'discardEffect', { cards: [...s.players[1].hand] });
  assert.equal(s.players[0].hand.length, 7);
  assert.equal(s.players[1].hand.length, 7);
  assert.equal(s.choice, null);
});
