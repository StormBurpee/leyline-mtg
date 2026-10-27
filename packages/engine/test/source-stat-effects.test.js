import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, stats, keywords } from '../src/index.js';
import { move, ref, notifyTriggers, captureDepartureContext, queueTrigger } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { effectValues, numericValue } from '../src/numeric-values.js';
import { validateNumericValue } from '../src/value-schema.js';
import { fixture, put, act, resolve } from './helpers.js';
const power = { kind: 'sourceStat', stat: 'power' };
const toughness = { kind: 'sourceStat', stat: 'toughness' };

test('source stats are resolving-effect-only, including nested expressions', () => {
  const nested = { kind: 'sum', values: [1, { kind: 'scale', factor: 2, value: power }] };
  assert.ok(validateNumericValue(nested).length);
  assert.deepEqual(validateNumericValue(nested, { effect: true }), []);
  assert.ok(validateNumericValue({ ...power, stat: 'loyalty' }, { effect: true }).length);
  assert.throws(() => numericValue(fixture(), power), /resolving effect/);
  for (const fields of [
    { baseStats: { power, toughness: 2 } },
    { selfBonus: { power: nested, toughness: 0 } },
    { costReduction: { amount: power } },
    {
      triggers: [
        {
          event: 'attack',
          condition: { kind: 'compare', left: power, right: 2, operator: 'gte' },
          effects: [],
        },
      ],
    },
  ])
    assert.throws(() => createRegistry([{ ...CARDS['Grizzly Bears'], ...fields }]));
});

test('Ashroot reads resolution-time counters and freezes both bonuses', () => {
  let s = fixture();
  const source = put(s, 'Ashroot Animist'),
    target = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'attack', { object: source });
  stabilize(s);
  assert.ok(!s.choice.targets.some((t) => t.id === source.id));
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s.objects[source.id].plusCounters = 3;
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 9, toughness: 9 });
  assert.ok(keywords(s, s.objects[target.id]).includes('trample'));
  s.objects[source.id].plusCounters = 20;
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 9, toughness: 9 });
});

test('Halana and Alena uses departure LKI, never a returned source incarnation', () => {
  let s = fixture();
  const source = put(s, 'Halana and Alena, Partners'),
    target = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'step', { player: 0, step: 'beginCombat' });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s.objects[source.id].plusCounters = 4;
  move(s, s.objects[source.id], 'graveyard');
  move(s, s.objects[source.id], 'battlefield');
  s.objects[source.id].plusCounters = 20;
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 6);
  assert.ok(keywords(s, s.objects[target.id]).includes('haste'));
});

test('War Machine grants power only and does not trigger on opposing combat', () => {
  let s = fixture();
  const source = put(s, 'War Machine, Legacy of Iron'),
    target = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'step', { player: 1, step: 'beginCombat' });
  assert.equal(s.pendingTriggers.length, 0);
  notifyTriggers(s, 'step', { player: 0, step: 'beginCombat' });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  const p = stats(s, s.objects[source.id]).power;
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 2 + p, toughness: 2 });
});

test('source power and toughness include animated base values, counters and modifiers; noncreatures yield zero', () => {
  const s = fixture(),
    source = put(s, 'Forest');
  const entry = { controller: 0, source: ref(source) };
  assert.equal(effectValues(s, { op: 'gainLife', amount: power }, entry).amount, 0);
  s.modifiers.push({
    objectId: source.id,
    incarnation: source.incarnation,
    expires: s.turn,
    animation: { power: 4, toughness: 7, colors: ['G'], subtypes: ['Elemental'] },
    addTypes: ['creature'],
    power: 2,
    toughness: 1,
  });
  source.plusCounters = 3;
  assert.deepEqual(stats(s, source), { power: 9, toughness: 11 });
  assert.equal(
    effectValues(s, { op: 'gainLife', amount: power }, entry).amount,
    stats(s, source).power,
  );
  assert.equal(
    effectValues(s, { op: 'gainLife', amount: toughness }, entry).amount,
    stats(s, source).toughness,
  );
  source.hidden = true;
  assert.equal(effectValues(s, { op: 'gainLife', amount: power }, entry).amount, 0);
});

test('simultaneous source/anthem departures preserve prebatch source stats', () => {
  const s = fixture(),
    source = put(s, 'Grizzly Bears'),
    anthem = put(s, 'Glorious Anthem');
  queueTrigger(s, source, [{ op: 'gainLife', amount: power }], 'snapshot');
  const context = captureDepartureContext(s);
  assert.equal(context.facts[source.id].power, 3);
  move(s, anthem, 'graveyard', context);
  move(s, source, 'graveyard', context);
  assert.equal(effectValues(s, { op: 'gainLife', amount: power }, s.pendingTriggers[0]).amount, 3);
});

test('own-death trigger gets predeparture effective source stats', () => {
  const s = fixture();
  s.catalog = createRegistry([
    ...Object.values(CARDS),
    {
      ...CARDS['Grizzly Bears'],
      name: 'Stat Witness',
      triggers: [
        {
          event: { event: 'dies', object: 'source' },
          effects: [{ op: 'gainLife', amount: power }],
        },
      ],
    },
  ]);
  const source = put(s, 'Stat Witness'),
    anthem = put(s, 'Glorious Anthem');
  source.plusCounters = 2;
  const context = captureDepartureContext(s);
  move(s, anthem, 'graveyard', context);
  move(s, source, 'graveyard', context);
  const entry = s.pendingTriggers.find((e) => e.name === 'Stat Witness');
  assert.ok(entry);
  assert.equal(effectValues(s, entry.effects[0], entry).amount, 5);
});

test('sacrificed activation source retains effective power through payment and resolution', () => {
  let s = fixture();
  s.catalog = createRegistry([
    ...Object.values(CARDS),
    {
      ...CARDS['Grizzly Bears'],
      name: 'Stat Sacrifice',
      activated: [{ cost: { sacrificeSelf: true }, effects: [{ op: 'gainLife', amount: power }] }],
    },
  ]);
  const source = put(s, 'Stat Sacrifice');
  source.plusCounters = 3;
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(s.objects[source.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].life, 25);
});

test('negative source power is retained for modifiers but counter/life amounts clamp to zero', () => {
  const s = fixture(),
    source = put(s, 'Grizzly Bears');
  s.modifiers.push({
    objectId: source.id,
    incarnation: source.incarnation,
    power: -5,
    toughness: 0,
    expires: s.turn,
  });
  const entry = { controller: 0, source: ref(source) };
  assert.equal(effectValues(s, { op: 'modify', power, toughness: 0 }, entry).power, -3);
  assert.equal(effectValues(s, { op: 'counterOn', amount: power }, entry).amount, 0);
});
