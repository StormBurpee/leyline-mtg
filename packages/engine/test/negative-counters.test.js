import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  CARD_IDS,
  createGame,
  createRegistry,
  dispatch,
  exportReplay,
  replay,
  chooseBotCommand,
  validateDefinition,
  stats,
  ref,
} from '../src/index.js';
import { move } from '../src/model.js';
import { resolveEffects, stateBasedActions, stabilize } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';

const names = ['Bile-Vial Boggart', 'Blight Rot', 'Darkness Descends', 'Nightmare Sower'];
const negative = (amount, extra = {}) => ({ op: 'counterOn', counter: '-1/-1', amount, ...extra });
const rich = () => {
  const s = fixture();
  s.players[0].mana.B = 100;
  s.players[0].mana.G = 100;
  return s;
};

test('all four negative-counter cards roundtrip without dropping any ability or counter kind', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const source = sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName });
    const compiled = compileCard(source, { identities: CARD_IDS });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(canonical(compiled.definition), canonical(CARDS[name]), name);
  }
  assert.deepEqual(CARDS['Blight Rot'].effects, [negative(4)]);
});

test('schema and semantic validation accept only the supported counter kinds', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  for (const name of ['Blight Rot', 'Darkness Descends']) {
    const source = sourceFromDefinition(CARDS[name], { id: 'test:counters' });
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    for (const counter of ['poison', null]) {
      source.abilities[0].effects[0].counter = counter;
      assert.equal(validate(source), false);
      const result = compileCard(source);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some((d) => d.code === 'UNSUPPORTED_COUNTER'));
    }
  }
  for (const bad of [
    { ...negative(1), counter: 'poison' },
    { ...negative(1), counter: null },
    negative(-1),
    negative(1, { subject: 'opponent' }),
  ])
    assert.ok(validateDefinition({ ...CARDS['Blight Rot'], effects: [bad] }).length);
  assert.ok(validateDefinition({ ...CARDS['Blight Rot'], target: 'player' }).length);
  const positive = sourceFromDefinition(CARDS['Blight Rot'], { id: 'test:positive' });
  positive.abilities[0].effects[0].counter = '+1/+1';
  assert.deepEqual(compileCard(positive).definition.effects, [{ op: 'counterOn', amount: 4 }]);
});

test('Blight Rot permanently lowers stats, cancels opposing counters, and kills indestructible at zero toughness', () => {
  let s = rich();
  const survivor = put(s, 'Grizzly Bears', 1);
  survivor.plusCounters = 5;
  let spell = put(s, 'Blight Rot', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(survivor) }));
  assert.deepEqual(stats(s, s.objects[survivor.id]), { power: 3, toughness: 3 });
  assert.equal(s.objects[survivor.id].plusCounters, 1);
  assert.equal(s.objects[survivor.id].minusCounters, 0);
  assert.equal(s.modifiers.length, 0);
  const victim = put(s, 'Zetalpa, Primal Dawn', 1);
  victim.minusCounters = 4;
  spell = put(s, 'Blight Rot', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(victim) }));
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 20);
});

test('placement does not cancel counters or run SBAs between resolving instructions', () => {
  const s = fixture();
  const source = put(s, 'Grizzly Bears');
  source.plusCounters = 2;
  resolveEffects(s, {
    controller: 0,
    source: ref(source),
    effects: [negative(2, { subject: 'source' }), { op: 'doubleCounters', subject: 'source' }],
  });
  assert.equal(source.plusCounters, 4);
  assert.equal(source.minusCounters, 2);
  assert.deepEqual(stats(s, source), { power: 4, toughness: 4 });
  stateBasedActions(s);
  assert.equal(source.plusCounters, 2);
  assert.equal(source.minusCounters, 0);
});

test('group placement snapshots recipients; SBA deaths preserve all death watchers and pre-departure stats', () => {
  const s = fixture();
  const boggart = put(s, 'Bile-Vial Boggart');
  boggart.plusCounters = 1;
  const artist = put(s, 'Blood Artist');
  const bear = put(s, 'Grizzly Bears', 1);
  const land = put(s, 'Swamp');
  resolveEffects(s, { controller: 0, effects: CARDS['Darkness Descends'].effects });
  assert.equal(boggart.plusCounters, 1);
  for (const object of [boggart, artist, bear]) {
    assert.equal(object.minusCounters, 2);
    assert.equal(object.zone, 'battlefield');
  }
  assert.equal(land.minusCounters, undefined);
  stateBasedActions(s);
  for (const object of [boggart, artist, bear]) assert.equal(object.zone, 'graveyard');
  assert.equal(s.pendingTriggers.filter((t) => t.name === 'Blood Artist').length, 3);
  const death = s.pendingTriggers.find((t) => t.name === 'Bile-Vial Boggart');
  assert.deepEqual(death.sourceStats, { power: 0, toughness: 0 });
  assert.equal(death.effects[0].counter, '-1/-1');
  assert.equal(boggart.minusCounters, undefined);
});

test('attached and filtered group negative counters support numeric amounts and noncreature permanents', () => {
  const s = fixture();
  const bearer = put(s, 'Grizzly Bears');
  const other = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const aura = put(s, 'Unflinching Courage');
  aura.attachedTo = ref(bearer);
  resolveEffects(s, {
    controller: 0,
    source: ref(aura),
    effects: [negative(1, { subject: 'attached' })],
  });
  assert.equal(bearer.minusCounters, 1);
  resolveEffects(s, {
    controller: 0,
    source: ref(bearer),
    effects: [
      {
        op: 'counterAll',
        counter: '-1/-1',
        where: { controller: 'you' },
        excludeSource: true,
        amount: { kind: 'sourceStat', stat: 'power' },
      },
    ],
  });
  assert.equal(bearer.minusCounters, 1);
  assert.equal(other.minusCounters, 3);
  assert.equal(aura.minusCounters, 3);
  assert.equal(enemy.minusCounters, undefined);
});

test('Blight Rot rejects illegal targets without mutation and cannot follow a returned incarnation', () => {
  let s = rich();
  const spell = put(s, 'Blight Rot', 0, 'hand');
  const land = put(s, 'Swamp', 1);
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(land) }).ok,
    false,
  );
  assert.deepEqual(s, before);
  const victim = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: spell.id, target: ref(victim) });
  move(s, s.objects[victim.id], 'hand');
  move(s, s.objects[victim.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[victim.id].minusCounters, undefined);
  assert.equal(s.objects[victim.id].zone, 'battlefield');
});

test('Bile-Vial Boggart death trigger survives its source leaving and allows either no target or one own creature', () => {
  for (const choose of [false, true]) {
    let s = fixture();
    const boggart = put(s, 'Bile-Vial Boggart');
    const bear = put(s, 'Grizzly Bears');
    move(s, boggart, 'graveyard');
    stabilize(s);
    assert.equal(s.choice.kind, 'triggerTargets');
    s = act(s, 'chooseTriggerTargets', { targets: { chosen: choose ? [ref(bear)] : [] } });
    move(s, s.objects[boggart.id], 'hand');
    s = resolve(s);
    assert.equal(s.objects[bear.id].minusCounters ?? 0, choose ? 1 : 0);
  }
});

test('Nightmare Sower triggers only for your opponent-turn spells and independently retains the chosen target', () => {
  for (const active of [0, 1]) {
    let s = rich();
    s.active = active;
    const sower = put(s, 'Nightmare Sower');
    const bear = put(s, 'Grizzly Bears');
    const enemy = put(s, 'Grizzly Bears', 1);
    const spell = put(s, 'Giant Growth', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, target: ref(bear) });
    if (!active) {
      assert.equal(s.choice, null);
      assert.equal(s.stack.length, 1);
      continue;
    }
    assert.equal(s.choice.kind, 'triggerTargets');
    const before = structuredClone(s);
    assert.equal(
      dispatch(s, {
        type: 'chooseTriggerTargets',
        player: 0,
        targets: { chosen: [ref(bear), ref(enemy)] },
      }).ok,
      false,
    );
    assert.deepEqual(s, before);
    const command = chooseBotCommand(s, 0);
    assert.deepEqual(command.targets.chosen, [ref(enemy)]);
    s = act(s, 'chooseTriggerTargets', command);
    move(s, s.objects[sower.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[enemy.id].minusCounters, 1);
    assert.equal(s.players[0].life, 20, 'counter placement is not lifelink damage');
    assert.equal(s.stack.length, 1, 'the triggering spell has not yet resolved');
  }
});

test('the bot targets an enemy with negative counters rather than treating them as a friendly buff', () => {
  const s = rich();
  const spell = put(s, 'Blight Rot', 0, 'hand');
  put(s, 'Grizzly Bears');
  const enemy = put(s, 'Zetalpa, Primal Dawn', 1);
  enemy.minusCounters = 4;
  const command = chooseBotCommand(s, 0);
  assert.equal(command.card, spell.id);
  assert.deepEqual(command.target, ref(enemy));
});

test('counter overflow rejects the resolving command without mutating its input', () => {
  let s = rich();
  const spell = put(s, 'Blight Rot', 0, 'hand');
  const bear = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: spell.id, target: ref(bear) });
  s = act(s, 'pass');
  s.objects[bear.id].minusCounters = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(s);
  const result = dispatch(s, { type: 'pass', player: s.priority });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'COUNTER_RANGE');
  assert.deepEqual(s, before);
});

test('full cast/death/optional-target/negative-counter replay is deterministic', () => {
  const catalog = createRegistry([
    ...names.map((name) => ({ ...CARDS[name], cost: {} })),
    CARDS.Forest,
  ]);
  const deck = [...names, ...Array(3).fill('Forest')];
  let s = createGame({
    catalog,
    minimumDeckSize: 7,
    mulligan: false,
    decks: [deck, Array(7).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  const boggart = id('Bile-Vial Boggart');
  const sower = id('Nightmare Sower');
  s = resolve(act(s, 'cast', { card: boggart }));
  s = resolve(act(s, 'cast', { card: sower }));
  s = resolve(act(s, 'cast', { card: id('Blight Rot'), target: ref(s.objects[boggart]) }));
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(s.objects[sower])] } });
  s = resolve(s);
  assert.equal(s.objects[sower].minusCounters, 1);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  s = resolve(act(s, 'cast', { card: id('Darkness Descends') }));
  assert.equal(s.objects[sower].zone, 'graveyard');
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});

test('existing remove-any-counter effects offer and remove negative counters, even without a reflexive target', () => {
  let s = fixture();
  const source = put(s, 'Leatherhead, Swamp Stalker');
  resolveEffects(s, {
    controller: 0,
    source: ref(source),
    effects: [negative(1, { subject: 'source' })],
  });
  resolveEffects(s, {
    controller: 0,
    source: ref(source),
    effects: CARDS[source.name].triggers[0].effects,
  });
  assert.deepEqual(s.choice.counters, ['-1/-1']);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.counter, '-1/-1');
  s = act(s, 'chooseCounter', command);
  assert.equal(s.objects[source.id].minusCounters, 0);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
});

test('Nightmare Sower ignores an opponent casting during that opponent turn', () => {
  let s = rich();
  s.active = 1;
  s.priority = 1;
  s.players[1].mana.G = 1;
  put(s, 'Nightmare Sower');
  const bear = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Giant Growth', 1, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(bear) }, 1);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 1);
  assert.equal(s.pendingTriggers.length, 0);
});
