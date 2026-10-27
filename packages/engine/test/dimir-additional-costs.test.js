import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  ref,
  stats,
  dispatch,
  legalActions,
  chooseBotCommand,
  castingPayment,
  castingProfile,
} from '../src/index.js';
import { move, addModifier } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('Bitter Triumph requires an explicit valid additional cost and excludes itself from discard', () => {
  const s = fixture(),
    spell = put(s, 'Bitter Triumph', 0, 'hand'),
    target = put(s, 'Llanowar Elves', 1);
  lands(s, 'Swamp', 2);
  for (const additionalCost of [
    undefined,
    null,
    { discard: ref(spell) },
    { life: false },
    { life: true, extra: 1 },
  ]) {
    const result = dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      target: ref(target),
      ...(additionalCost !== undefined ? { additionalCost } : {}),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, s);
  }
  assert.ok(legalActions(s, 0).some((a) => a.card === spell.id && a.additionalCost?.life));
});

test('Bitter Triumph discards before resolution and life remains paid if the spell fizzles', () => {
  let s = fixture();
  const spell = put(s, 'Bitter Triumph', 0, 'hand'),
    spare = put(s, 'Forest', 0, 'hand'),
    target = put(s, 'The Theorist, Jace Beleren', 1);
  lands(s, 'Swamp', 2);
  s = act(s, 'cast', {
    card: spell.id,
    target: ref(target),
    additionalCost: { discard: ref(spare) },
  });
  assert.equal(s.objects[spare.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 20);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  s = fixture();
  const other = put(s, 'Bitter Triumph', 0, 'hand'),
    elf = put(s, 'Llanowar Elves', 1);
  lands(s, 'Swamp', 2);
  s = act(s, 'cast', { card: other.id, target: ref(elf), additionalCost: { life: true } });
  assert.equal(s.players[0].life, 17);
  move(s, s.objects[elf.id], 'hand');
  s = resolve(s);
  assert.equal(s.players[0].life, 17);
});

test('Bitter life payment reserves life needed by pain mana and rejects atomically', () => {
  const s = fixture(),
    spell = put(s, 'Bitter Triumph', 0, 'hand'),
    target = put(s, 'Llanowar Elves', 1);
  s.players[0].life = 2;
  lands(s, 'Swamp', 2);
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      target: ref(target),
      additionalCost: { life: true },
    }).ok,
    false,
  );
});

test('Requiting Hex blights at cast time, allows lethal blight, and gains life only on resolution', () => {
  let s = fixture();
  const hex = put(s, 'Requiting Hex', 0, 'hand'),
    mine = put(s, 'Llanowar Elves'),
    enemy = put(s, 'Hired Claw', 1);
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: hex.id, target: ref(enemy), additionalCost: { blight: ref(mine) } });
  assert.equal(s.objects[mine.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 20);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
});

test('Requiting optional cost can be declined and counters cancel in state-based actions', () => {
  let s = fixture();
  const hex = put(s, 'Requiting Hex', 0, 'hand'),
    mine = put(s, 'Llanowar Elves'),
    enemy = put(s, 'Hired Claw', 1);
  mine.plusCounters = 2;
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: hex.id, target: ref(enemy), additionalCost: { blight: ref(mine) } });
  assert.equal(s.objects[mine.id].plusCounters, 1);
  assert.equal(s.objects[mine.id].minusCounters, 0);
  assert.equal(stats(s, s.objects[mine.id]).power, 2);
  s = fixture();
  const other = put(s, 'Requiting Hex', 0, 'hand'),
    target = put(s, 'Hired Claw', 1);
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: other.id, target: ref(target), additionalCost: null });
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
});

function counterSetup() {
  let s = fixture();
  const spell = put(s, 'We Say Thee Nay!', 0, 'hand'),
    enemy = put(s, 'Unsummon', 1, 'hand'),
    target = put(s, 'Hired Claw');
  lands(s, 'Island', 2, 0);
  lands(s, 'Island', 1, 1);
  s.priority = 1;
  s = act(s, 'cast', { card: enemy.id, target: ref(target) }, 1);
  s = act(s, 'pass', {}, 1);
  return { s, spell, enemy, target };
}

test('Teamwork taps summoning-sick creatures, locks the bonus and asks for four rather than two', () => {
  let { s, spell, enemy } = counterSetup();
  const a = put(s, 'Llanowar Elves', 0, 'battlefield', { ready: false }),
    b = put(s, 'Llanowar Elves', 0, 'battlefield', { ready: false });
  s = act(s, 'cast', {
    card: spell.id,
    target: { kind: 'stack', id: s.stack[0].id },
    additionalCost: { teamwork: [ref(a), ref(b)] },
  });
  assert.ok(s.objects[a.id].tapped && s.objects[b.id].tapped);
  move(s, s.objects[a.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.cost.mana.generic, 4);
  s = act(s, 'payCost', { pay: false }, 1);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
});

test('Teamwork rejects duplicate, insufficient, tapped and stale refs; optional decline asks for two', () => {
  let { s, spell } = counterSetup();
  const elf = put(s, 'Llanowar Elves');
  const target = { kind: 'stack', id: s.stack[0].id };
  for (const teamwork of [[ref(elf)], [ref(elf), ref(elf)], [{ ...ref(elf), incarnation: 9 }]])
    assert.equal(
      dispatch(s, { type: 'cast', player: 0, card: spell.id, target, additionalCost: { teamwork } })
        .ok,
      false,
    );
  s = act(s, 'cast', { card: spell.id, target, additionalCost: null });
  s = resolve(s);
  assert.equal(s.choice.cost.mana.generic, 2);
});

test('Additional cost choices cannot be smuggled onto ordinary spells', () => {
  const s = fixture(),
    spell = put(s, 'Unsummon', 0, 'hand'),
    elf = put(s, 'Llanowar Elves', 1);
  lands(s, 'Island', 1);
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(elf), additionalCost: null })
      .ok,
    false,
  );
});

test('opaque additional-cost refs decode safely and full paid-cast replay is deterministic', async () => {
  const { createSession } = await import('../../simulation/session.js');
  const { createRegistry, replay } = await import('../src/index.js');
  const catalog = createRegistry({
    ...CARDS,
    'Bitter Triumph': { ...CARDS['Bitter Triumph'], cost: {} },
    'Llanowar Elves': { ...CARDS['Llanowar Elves'], cost: {} },
  });
  const session = createSession({
    catalog,
    mulligan: false,
    minimumDeckSize: 8,
    decks: [
      [...Array(4).fill('Bitter Triumph'), ...Array(4).fill('Llanowar Elves')],
      Array(8).fill('Forest'),
    ],
  });
  const step = (command) => {
    const c = session.context(),
      r = session.step({ player: c.player, ...command });
    assert.ok(r.ok, r.error?.message);
  };
  while (session.context().observation.step !== 'main1') step({ type: 'pass' });
  let c = session.context();
  const elf = c.observation.players[0].hand.find(
    (id) => c.observation.objects[id].name === 'Llanowar Elves',
  );
  step({ type: 'cast', card: elf });
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  const action = c.actions.find((a) => a.type === 'cast' && a.additionalCost?.discard);
  assert.ok(action);
  assert.match(action.additionalCost.discard.id, /^object:/);
  assert.match(action.target.id, /^object:/);
  const forged = structuredClone(action);
  forged.additionalCost.discard.id = 'concealed';
  assert.equal(session.step({ ...forged, player: c.player }).ok, false);
  step(action);
  const state = replay(session.exportReplay());
  assert.equal(state.stack.length, 1);
  assert.equal(state.objects[state.stack[0].additionalCost.discard.id].zone, 'graveyard');
  assert.deepEqual(replay(session.exportReplay()), state);
});

test('Teamwork cannot use a selected creature as an automatic mana source', () => {
  let { s, spell } = counterSetup();
  for (const object of Object.values(s.objects))
    if (object.zone === 'battlefield' && object.controller === 0 && object.name === 'Island')
      move(s, object, 'graveyard');
  const elf = put(s, 'Llanowar Elves');
  elf.plusCounters = 1;
  put(s, 'Island');
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      target: { kind: 'stack', id: s.stack[0].id },
      additionalCost: { teamwork: [ref(elf)] },
    }).ok,
    false,
  );
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      target: { kind: 'stack', id: s.stack[0].id },
      additionalCost: null,
    }).ok,
    true,
  );
});

test('additional life reserves pain mana without prematurely changing mana activation conditions', async () => {
  const { createRegistry } = await import('../src/index.js');
  let s = fixture();
  const spell = put(s, 'Bitter Triumph', 0, 'hand'),
    enemy = put(s, 'Hired Claw', 1);
  put(s, 'Starting Town');
  put(s, 'Forest');
  s.players[0].life = 3;
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      target: ref(enemy),
      additionalCost: { life: true },
    }).ok,
    false,
  );
  s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Conditional black source': {
      name: 'Conditional black source',
      type: 'land',
      cost: {},
      mana: ['B'],
      manaConditions: {
        B: { kind: 'compare', left: { kind: 'life', player: 'you' }, right: 4, operator: 'gte' },
      },
    },
  });
  const cast = put(s, 'Bitter Triumph', 0, 'hand'),
    target = put(s, 'Hired Claw', 1);
  put(s, 'Conditional black source');
  put(s, 'Forest');
  s.players[0].life = 4;
  s = act(s, 'cast', { card: cast.id, target: ref(target), additionalCost: { life: true } });
  assert.equal(s.players[0].life, 1);
});
