import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  castingChoices,
  spellProfile,
  castingProfile,
  legalActions,
  dispatch,
  exportReplay,
  replay,
  createGame,
} from '../src/index.js';
import { manaValue } from '../src/mana-value.js';
import { planPayment } from '../src/mana.js';
import { fixture, put, act, resolve, lands } from './helpers.js';
const sample = (extra = {}) => ({
  name: 'Twobrid Fixture',
  type: 'creature',
  cost: { '2/W': 2 },
  power: 2,
  toughness: 2,
  ...extra,
});
const withCard = (card) => {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, [card.name]: card });
  return [s, put(s, card.name, 0, 'hand')];
};
test('twobrid choices announce equivalent costs and deduplicate repeated symbols', () => {
  const d = sample();
  assert.deepEqual(
    castingChoices(d).map((_, i) => spellProfile(d, i).cost),
    [{ W: 2 }, { generic: 2, W: 1 }, { generic: 4 }],
  );
  assert.equal(manaValue(d), 4);
  assert.equal(createRegistry([d])[d.name].color.join(''), 'W');
  assert.equal(castingChoices(CARDS['Kin-Tree Severance']).length, 8);
  assert.equal(manaValue(CARDS['Kin-Tree Severance']), 6);
});
test('choice happens before generic reductions, which never remove colored obligations', () => {
  const [s, o] = withCard(
    sample({ costModifiers: [{ scope: 'self', change: 'reduce', amount: 3 }] }),
  );
  assert.deepEqual(castingProfile(s, 0, o, 0).cost, { W: 2 });
  assert.deepEqual(castingProfile(s, 0, o, 1).cost, { W: 1, generic: 0 });
  assert.deepEqual(castingProfile(s, 0, o, 2).cost, { generic: 1 });
  lands(s, 'Forest', 1);
  const actions = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === o.id);
  assert.deepEqual(
    actions.map((a) => a.mode),
    [2],
  );
  const r = dispatch(s, { ...actions[0], player: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.state.stack[0].mode, 2);
  assert.equal(manaValue(r.state.stack[0].sourceDefinition), 4);
});
test('all generic and mixed colored payments are distinct accepted choices', () => {
  for (const [mode, types] of [
    [0, ['Plains', 'Plains']],
    [1, ['Plains', 'Forest', 'Forest']],
    [2, ['Forest', 'Forest', 'Forest', 'Forest']],
  ]) {
    let [s, o] = withCard(sample());
    for (const type of types) put(s, type);
    s = act(s, 'cast', { card: o.id, mode });
    assert.equal(s.stack[0].mode, mode);
    assert.equal(
      Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.tapped).length,
      types.length,
    );
  }
  const [s, o] = withCard(sample());
  lands(s, 'Forest', 2);
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: o.id, mode: 2 }).ok, false);
  assert.equal(planPayment(s, 0, { '2/W': 1 }), null);
});
test('convoke pays the announced generic or colored equivalent without reducing printed mana value', () => {
  let [s, o] = withCard(sample({ cost: { '2/W': 1 }, keywords: ['convoke'] }));
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: o.id, mode: 0 }).ok, false);
  s = act(s, 'cast', {
    card: o.id,
    mode: 1,
    convoke: [
      { card: a.id, symbol: 'generic' },
      { card: b.id, symbol: 'generic' },
    ],
  });
  assert.equal(manaValue(s.stack[0].sourceDefinition), 2);
  assert.ok(s.objects[a.id].tapped && s.objects[b.id].tapped);
});
test('unsupported non-casting twobrid and competing casting options fail closed', () => {
  for (const extra of [
    { cost: { '2/W': 6 } },
    { cost: { '2/W': 1, X: 1 } },
    { warp: { W: 1 } },
    { plot: { W: 1 } },
    { kicker: { cost: { W: 1 }, effects: [] } },
    { activated: [{ cost: { mana: { '2/W': 1 } }, effects: [] }] },
  ])
    assert.throws(() => createRegistry([sample(extra)]));
});
test('real cards expose complete abilities and affordable generic choices', () => {
  let s = fixture();
  lands(s, 'Forest', 6);
  const o = put(s, 'Temur Tawnyback', 0, 'hand');
  put(s, 'Grizzly Bears', 0, 'hand');
  const a = legalActions(s, 0).find((a) => a.type === 'cast' && a.card === o.id && a.mode === 7);
  assert.ok(a);
  s = dispatch(s, { ...a, player: 0 }).state;
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(CARDS['Reputable Merchant'].triggers.length, 2);
  assert.equal(CARDS['Reigning Victor'].triggers.length, 2);
});
test('announced payment mode survives full deterministic replay', () => {
  const d = sample({
    cost: { '2/W': 1 },
    costModifiers: [{ scope: 'self', change: 'reduce', amount: 2 }],
  });
  const catalog = createRegistry({ ...CARDS, [d.name]: d });
  let s = createGame({
    mulligan: false,
    minimumDeckSize: 1,
    catalog,
    decks: [
      [d.name, d.name, d.name, d.name, 'Forest', 'Forest', 'Forest', 'Forest'],
      Array(8).fill('Forest'),
    ],
  });
  for (let i = 0; i < 10 && s.step !== 'main1'; i++) s = act(s, 'pass');
  const o = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === d.name);
  assert.ok(o);
  s = act(s, 'cast', { card: o.id, mode: 1 });
  const record = exportReplay(s);
  assert.equal(record.commands.at(-1).mode, 1);
  const restored = replay(record);
  assert.deepEqual(restored.stack, s.stack);
  assert.equal(restored.rulesRevision, s.rulesRevision);
});
test('cost increases apply before reductions after twobrid announcement', () => {
  const [s, o] = withCard(
    sample({
      costModifiers: [
        { scope: 'self', change: 'increase', amount: 1 },
        { scope: 'self', change: 'reduce', amount: 3 },
      ],
    }),
  );
  assert.deepEqual(castingProfile(s, 0, o, 2).cost, { generic: 2 });
  assert.deepEqual(castingProfile(s, 0, o, 0).cost, { W: 2 });
});
test('Kin-Tree Severance keeps its original mana-value filter with each payment choice', () => {
  let s = fixture();
  lands(s, 'Forest', 6);
  const spell = put(s, 'Kin-Tree Severance', 0, 'hand'),
    small = put(s, 'Grizzly Bears', 1),
    large = put(s, 'Giant Spider', 1);
  const actions = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === spell.id);
  assert.ok(actions.some((a) => a.mode === 7 && a.target.id === large.id));
  assert.ok(!actions.some((a) => a.target.id === small.id));
  s = act(s, 'cast', {
    card: spell.id,
    mode: 7,
    target: { kind: 'object', id: large.id, incarnation: large.incarnation },
  });
  s = resolve(s);
  assert.equal(s.objects[large.id].zone, 'exile');
});

test('twobrid mode indices do not depend on mana-cost object key order', () => {
  const a = sample({ cost: { '2/W': 1, '2/G': 1 } });
  const b = sample({ cost: { '2/G': 1, '2/W': 1 } });
  assert.deepEqual(
    castingChoices(a).map((_, i) => spellProfile(a, i).cost),
    castingChoices(b).map((_, i) => spellProfile(b, i).cost),
  );
});

test('cost modifier mana-value filters use printed twobrid value, not announced payment', () => {
  const [s, o] = withCard(
    sample({
      costModifiers: [
        { scope: 'self', change: 'increase', amount: 1, where: { manaValue: { gte: 4 } } },
      ],
    }),
  );
  assert.deepEqual(castingProfile(s, 0, o, 0).cost, { W: 2, generic: 1 });
  assert.deepEqual(castingProfile(s, 0, o, 1).cost, { W: 1, generic: 3 });
});
