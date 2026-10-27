import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  legalActions,
  ref,
  stats,
  chooseBotCommand,
  validateDefinition,
  activationSacrificeCandidates,
} from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { addModifier, move } from '../src/model.js';
function setup(cost = {}, ability = {}) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Chosen Sacrificer': {
      name: 'Chosen Sacrificer',
      type: 'creature',
      cost: {},
      color: [],
      keywords: [],
      power: 2,
      toughness: 3,
      activated: [
        {
          cost: {
            sacrifice: { count: 1, where: { type: 'creature' }, excludeSource: true },
            ...cost,
          },
          effects: [{ op: 'counterOn', subject: 'source', amount: 1 }],
          text: 'Sacrifice another creature: Put a counter on this creature.',
          ...ability,
        },
      ],
    },
  });
  return { s, source: put(s, 'Chosen Sacrificer'), victim: put(s, 'Grizzly Bears') };
}
test('chosen activation sacrifice is paid before resolution, with real death and sacrifice events', () => {
  let { s, source, victim } = setup();
  const action = legalActions(s, 0).find((a) => a.type === 'activate' && a.card === source.id);
  assert.deepEqual(action.sacrifices, [ref(victim)]);
  s = act(s, 'activate', action);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(stats(s, s.objects[source.id]).power, 2);
  assert.ok(s.events.some((e) => e.type === 'sacrificed' && e.objectId === victim.id));
  s = resolve(s);
  assert.equal(stats(s, s.objects[source.id]).power, 3);
});
test('missing, stale, self, duplicate, wrong-controller/type, malformed and surplus choices reject atomically', () => {
  const { s, source, victim } = setup({ mana: { generic: 1 }, tap: true, life: 1 });
  const enemy = put(s, 'Grizzly Bears', 1),
    land = lands(s, 'Forest', 1)[0];
  for (const sacrifices of [
    undefined,
    null,
    [],
    [ref(source)],
    [ref(victim), ref(victim)],
    [ref(enemy)],
    [ref(land)],
    [{ ...ref(victim), incarnation: 999 }],
    [{ ...ref(victim), hidden: true }],
    ['bad'],
  ]) {
    const before = structuredClone(s),
      result = dispatch(s, {
        type: 'activate',
        player: 0,
        card: source.id,
        ability: 0,
        sacrifices,
      });
    assert.equal(result.ok, false, JSON.stringify(sacrifices));
    assert.deepEqual(s, before);
  }
});
test('current controller, current types and exact incarnations define candidates; hexproof does not prevent cost selection', () => {
  const { s, source, victim } = setup();
  victim.controller = 1;
  assert.deepEqual(
    activationSacrificeCandidates(
      s,
      0,
      s.catalog['Chosen Sacrificer'].activated[0].cost,
      source.id,
    ),
    [],
  );
  victim.controller = 0;
  addModifier(s, {
    objectId: victim.id,
    incarnation: victim.incarnation,
    power: 0,
    toughness: 0,
    keywords: ['hexproof'],
    expires: s.turn,
  });
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: source.id,
      ability: 0,
      sacrifices: [ref(victim)],
    }).ok,
    true,
  );
});
test('selected permanents may tap for mana first but mana-sacrificing sources cannot pay twice', () => {
  let { s, source } = setup({ mana: { G: 1 } });
  const elf = put(s, 'Llanowar Elves');
  s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(elf)] });
  assert.equal(s.objects[elf.id].zone, 'graveyard');
  ({ s, source } = setup({ mana: { B: 1 }, sacrifice: { count: 1, where: { type: 'artifact' } } }));
  const treasure = put(s, 'Treasure Token');
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: source.id,
      ability: 0,
      sacrifices: [ref(treasure)],
    }).ok,
    false,
  );
  assert.deepEqual(s, before);
  lands(s, 'Swamp', 1);
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: source.id,
      ability: 0,
      sacrifices: [ref(treasure)],
    }).ok,
    true,
  );
});
test('targets are chosen before costs, so a sacrificed target fizzles rather than changing targets', () => {
  let { s, source, victim } = setup(
    {},
    { target: 'creature', effects: [{ op: 'counterOn', amount: 1 }] },
  );
  s = act(s, 'activate', {
    card: source.id,
    ability: 0,
    target: ref(victim),
    sacrifices: [ref(victim)],
  });
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.ok(s.events.some((e) => e.type === 'fizzled'));
});
test('source and quantity-selected sacrifices are one simultaneous batch and source LKI persists', () => {
  let { s, source, victim } = setup(
    { sacrificeSelf: true, sacrifice: { count: 2, where: { type: 'creature' } } },
    { effects: [{ op: 'draw', count: 1 }] },
  );
  const other = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(victim), ref(other)] });
  for (const o of [source, victim, other]) assert.equal(s.objects[o.id].zone, 'graveyard');
  assert.equal(s.stack.at(-1).sourceStats.power, 2);
  assert.equal(s.events.filter((e) => e.type === 'sacrificed').length, 3);
});

test('current types and returned incarnations are rechecked rather than trusting a previous candidate', () => {
  const { s, source, victim } = setup();
  const chosen = ref(victim);
  victim.definitionOverride = {
    ...s.catalog['Grizzly Bears'],
    type: 'artifact',
    types: ['artifact'],
  };
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, sacrifices: [chosen] })
      .ok,
    false,
  );
  delete victim.definitionOverride;
  move(s, victim, 'graveyard');
  move(s, victim, 'battlefield');
  assert.notEqual(victim.incarnation, chosen.incarnation);
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, sacrifices: [chosen] })
      .ok,
    false,
  );
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: source.id,
      ability: 0,
      sacrifices: [ref(victim)],
    }).ok,
    true,
  );
});
test('source and other sacrifice share one death batch and predeparture anthem facts', () => {
  let { s, source, victim } = setup(
    { sacrificeSelf: true },
    { effects: [{ op: 'draw', count: 1 }] },
  );
  source.definitionOverride = {
    ...s.catalog['Chosen Sacrificer'],
    static: { kind: 'anthem', power: 1, toughness: 1 },
    triggers: [
      {
        event: {
          event: 'diesGroup',
          controller: 'you',
          excludeSource: true,
          filter: { power: { gte: 3 } },
        },
        effects: [{ op: 'gainLife', amount: 1 }],
      },
    ],
  };
  s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(victim)] });
  const triggers = s.stack.filter((e) => e.label?.includes('triggered ability'));
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].sourceStats.power, 3);
  assert.equal(s.stack[0].sourceStats.power, 3);
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});
test('mana-sacrifice reservations account for every selected permanent in a quantity cost', () => {
  const { s, source } = setup({
    mana: { generic: 1 },
    sacrifice: { count: 2, where: { type: 'artifact' } },
  });
  const a = put(s, 'Treasure Token'),
    b = put(s, 'Treasure Token');
  const command = {
    type: 'activate',
    player: 0,
    card: source.id,
    ability: 0,
    sacrifices: [ref(a), ref(b)],
  };
  assert.equal(dispatch(s, command).ok, false);
  const third = put(s, 'Treasure Token');
  const result = dispatch(s, command);
  assert.equal(result.ok, true, result.error?.message);
  for (const object of [a, b, third]) assert.equal(result.state.objects[object.id], undefined);
});
test('bots choose the cheapest valid selected cost and do not feed expensive creatures to small counters', () => {
  let { s, source } = setup({}, { effects: [{ op: 'draw', count: 1 }] });
  const cheap = put(s, 'Ornithopter');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.card, source.id);
  assert.deepEqual(command.sacrifices, [ref(cheap)]);
  assert.equal(dispatch(s, command).ok, true);
  ({ s } = setup());
  assert.notEqual(chooseBotCommand(s, 0).type, 'activate');
});
test('chosen-sacrifice mana abilities fail closed rather than incorrectly using the stack', () => {
  const { s } = setup();
  const definition = structuredClone(s.catalog['Chosen Sacrificer']);
  definition.activated[0].effects = [{ op: 'addMana', mana: { B: 1 } }];
  assert.match(validateDefinition(definition).join(' '), /selected-sacrifice mana abilities/);
});
test('unrelated and source-only abilities reject an unsolicited selected cost without changing legacy IDs', () => {
  const { s, source, victim } = setup(
    { sacrifice: undefined, sacrificeSelf: true },
    { effects: [{ op: 'draw', count: 1 }] },
  );
  const command = { type: 'activate', player: 0, card: source.id, ability: 0 };
  const baseline = dispatch(s, command);
  assert.equal(baseline.ok, true);
  assert.equal(baseline.state.stack[0].id, `s${s.nextId + 1}`);
  assert.equal(dispatch(s, { ...command, sacrifices: [ref(victim)] }).ok, false);
});

test('mana payment changing selected eligibility is rejected atomically and not proposed as legal', () => {
  const { s, source, victim } = setup({
    mana: { G: 1 },
    sacrifice: {
      count: 1,
      excludeSource: true,
      where: { all: [{ type: 'creature' }, { power: { gte: 3 } }] },
    },
  });
  const treasure = put(s, 'Treasure Token');
  treasure.definitionOverride = {
    ...s.catalog['Treasure Token'],
    static: { kind: 'anthem', power: 1, toughness: 1 },
  };
  assert.equal(stats(s, victim).power, 3);
  const before = structuredClone(s),
    command = {
      type: 'activate',
      player: 0,
      card: source.id,
      ability: 0,
      sacrifices: [ref(victim)],
    };
  assert.equal(dispatch(s, command).ok, false);
  assert.deepEqual(s, before);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'activate' && a.card === source.id),
    false,
  );
  lands(s, 'Forest', 1);
  assert.equal(dispatch(s, command).ok, true);
});

test('bot does not repeatedly sacrifice into already-pending protection or stack draws past its library', () => {
  let { s, source } = setup(
    {},
    {
      effects: [
        { op: 'modify', subject: 'source', power: 0, toughness: 0, keywords: ['indestructible'] },
      ],
    },
  );
  put(s, 'Ornithopter');
  s.stack.push({
    id: 'threat',
    kind: 'ability',
    name: 'Removal',
    controller: 1,
    source: null,
    effects: [{ op: 'destroy' }],
    targetKind: 'creature',
    target: ref(source),
  });
  let command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  s = act(s, 'activate', command);
  assert.notEqual(chooseBotCommand(s, 0).type, 'activate');
  ({ s, source } = setup({}, { effects: [{ op: 'draw', count: 1 }] }));
  put(s, 'Ornithopter');
  put(s, 'Ornithopter');
  while (s.players[0].library.length > 1) move(s, s.objects[s.players[0].library.at(-1)], 'exile');
  command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  s = act(s, 'activate', command);
  assert.notEqual(chooseBotCommand(s, 0).type, 'activate');
});
