import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, ref } from '../src/index.js';
import { move, notifyTriggers } from '../src/model.js';
import { resolveEffects, dealDamage, stabilize } from '../src/effects.js';
import { chooseBotCommand } from '../src/bot.js';
import { fixture, put, act, resolve, lands } from './helpers.js';

function setup(effect, tail = []) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Edict: { name: 'Edict', type: 'sorcery', cost: {}, effects: [effect, ...tail] },
    Protected: {
      name: 'Protected',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      keywords: ['indestructible', 'hexproof', 'shroud'],
    },
    Witness: {
      name: 'Witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [{ event: 'otherCreatureDies', effects: [{ op: 'gainLife', amount: 1 }] }],
    },
  });
  return s;
}
function cast(s) {
  return resolve(act(s, 'cast', { card: put(s, 'Edict', 0, 'hand').id }));
}
const edict = { op: 'sacrifice', player: 'opponent', count: 1, where: { type: 'creature' } };

test('edict chooses without targeting and ignores indestructible; resumes subsequent instructions', () => {
  let s = setup(edict, [{ op: 'gainLife', amount: 2 }]);
  const protectedId = put(s, 'Protected', 1).id;
  const other = put(s, 'Raging Goblin', 1).id;
  const land = put(s, 'Forest', 1).id;
  s = cast(s);
  assert.equal(s.choice.player, 1);
  assert.deepEqual(s.choice.cards, [protectedId, other]);
  assert.equal(s.players[0].life, 20);
  for (const cards of [[], [protectedId, other], [land]])
    assert.equal(dispatch(s, { type: 'sacrifice', player: 1, cards }).ok, false);
  assert.equal(dispatch(s, { type: 'sacrifice', player: 0, cards: [protectedId] }).ok, false);
  s = act(s, 'sacrifice', { cards: [protectedId] });
  assert.equal(s.objects[protectedId].zone, 'graveyard');
  assert.equal(s.objects[other].zone, 'battlefield');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.resolving, null);
});

test('APNAP choices precede every departure; all deaths use the same pre-batch witnesses', () => {
  let s = setup({ ...edict, player: 'all', count: 2 });
  const a = put(s, 'Witness', 0).id,
    b = put(s, 'Witness', 1).id;
  s = cast(s);
  assert.equal(s.choice.player, s.active);
  assert.equal(s.choice.count, 1);
  s = act(s, 'sacrifice', { cards: [a] });
  assert.equal(s.objects[a].zone, 'battlefield');
  assert.equal(s.objects[b].zone, 'battlefield');
  assert.equal(s.choice.player, 1);
  s = act(s, 'sacrifice', { cards: [b] });
  assert.equal(s.objects[a].zone, 'graveyard');
  assert.equal(s.objects[b].zone, 'graveyard');
  assert.equal(s.stack.length, 2);
  s = resolve(resolve(s));
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 21);
});

test('no eligible objects continues immediately; stable filters and bot select only eligible permanents', () => {
  let s = setup({ ...edict, where: { all: [{ type: 'artifact' }, { not: { token: true } }] } });
  put(s, 'Raging Goblin', 1);
  s = cast(s);
  assert.equal(s.choice, null);
  s = setup(edict);
  put(s, 'Forest', 1);
  const id = put(s, 'Protected', 1).id;
  s = cast(s);
  const command = chooseBotCommand(s, 1);
  assert.equal(command.type, 'sacrifice');
  assert.deepEqual(command.cards, [id]);
  assert.equal(dispatch(s, command).ok, true);
});

test('stale incarnation cannot be sacrificed by a pending choice or a self-sacrifice trigger', () => {
  let s = setup(edict);
  const id = put(s, 'Protected', 1).id;
  s = cast(s);
  move(s, s.objects[id], 'exile');
  move(s, s.objects[id], 'battlefield');
  assert.equal(dispatch(s, { type: 'sacrifice', player: 1, cards: [id] }).ok, false);
  const own = put(s, 'Protected', 0),
    source = ref(own);
  move(s, own, 'exile');
  move(s, own, 'battlefield');
  resolveEffects(s, { source, controller: 0, effects: [{ op: 'sacrificeSelf' }] });
  assert.equal(own.zone, 'battlefield');
  resolveEffects(s, { source: ref(own), controller: 1, effects: [{ op: 'sacrificeSelf' }] });
  assert.equal(own.zone, 'battlefield');
  resolveEffects(s, { source: ref(own), controller: 0, effects: [{ op: 'sacrificeSelf' }] });
  assert.equal(own.zone, 'graveyard');
});

test('Frostbite Pyromental draws two for combat damage and sacrifices at either player’s end step', () => {
  let s = fixture();
  const pyro = put(s, 'Frostbite Pyromental');
  dealDamage(
    s,
    { ...ref(pyro), controller: 0, definition: CARDS[pyro.name], keywords: [] },
    { kind: 'player', id: 1 },
    4,
    true,
  );
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
  notifyTriggers(s, 'step', { player: 1, step: 'end' });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[pyro.id].zone, 'graveyard');
});

test('Cornered by Black Mages waits for the opponent then creates a functional Wizard token', () => {
  let s = fixture();
  lands(s, 'Swamp', 3);
  const victim = put(s, 'Raging Goblin', 1);
  s = resolve(
    act(s, 'cast', {
      card: put(s, 'Cornered by Black Mages', 0, 'hand').id,
      target: { kind: 'player', id: 1 },
    }),
  );
  assert.equal(s.choice.kind, 'sacrifice');
  assert.equal(
    Object.values(s.objects).some((o) => o.name === 'Black Mage Wizard Token'),
    false,
  );
  s = act(s, 'sacrifice', { cards: [victim.id] });
  const token = Object.values(s.objects).find((o) => o.name === 'Black Mage Wizard Token');
  assert.equal(token.zone, 'battlefield');
  lands(s, 'Forest', 1);
  s = act(s, 'cast', { card: put(s, 'Pick Your Poison', 0, 'hand').id, mode: 0 });
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
});

test('Pick Your Poison flying mode excludes grounded creatures and noncreatures', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const flying = put(s, 'Wind Drake', 1);
  put(s, 'Raging Goblin', 1);
  s = resolve(act(s, 'cast', { card: put(s, 'Pick Your Poison', 0, 'hand').id, mode: 2 }));
  assert.deepEqual(s.choice.cards, [flying.id]);
  s = act(s, 'sacrifice', { cards: [flying.id] });
  assert.equal(s.objects[flying.id].zone, 'graveyard');
});

test('APNAP order follows active player, not the effect controller; choices retain public opaque handles', () => {
  let s = setup({ ...edict, player: 'all' });
  s.active = 1;
  const a = put(s, 'Protected', 0),
    b = put(s, 'Protected', 1);
  resolveEffects(s, { controller: 0, effects: [{ ...edict, player: 'all' }] });
  assert.equal(s.choice.player, 1);
  assert.deepEqual(s.choice.refs, [ref(b)]);
  s = act(s, 'sacrifice', { cards: [b.id] });
  assert.equal(s.choice.player, 0);
  assert.deepEqual(s.choice.cards, [a.id]);
  assert.equal(s.objects[b.id].zone, 'battlefield');
});
