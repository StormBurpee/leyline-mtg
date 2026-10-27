import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, ref, stats, playerView } from '../src/index.js';
import { addObject, move } from '../src/model.js';
import { notifyTargeted } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const ping = (s, object, controller = 0, kind = 'spell') =>
  notifyTargeted(s, { id: 'targeting', kind, controller, target: ref(object) });
const custom = (s, name, triggers, extra = {}) => {
  const d = {
    name,
    type: 'creature',
    cost: {},
    power: 2,
    toughness: 2,
    keywords: [],
    triggers,
    ...extra,
  };
  s.catalog = createRegistry({ ...s.catalog, [name]: d });
  return put(s, name);
};
const targeted = { event: 'targeted', object: 'source', targetingController: 'you' };
const draw = [{ op: 'draw', count: 1 }];
test('valiant distinguishes targeting controller, occurs above spell, and only first friendly target counts', () => {
  let s = fixture();
  const mouse = put(s, 'Seedglaive Mentor');
  ping(s, mouse, 1);
  assert.equal(s.pendingTriggers.length, 0);
  lands(s, 'Forest', 2);
  const spell = put(s, 'Giant Growth', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(mouse) });
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).name, mouse.name);
  assert.equal(s.objects[mouse.id].plusCounters, 0);
  s = resolve(s);
  assert.equal(s.objects[mouse.id].plusCounters, 1);
  ping(s, s.objects[mouse.id], 0, 'ability');
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  ping(s, s.objects[mouse.id], 0, 'ability');
  assert.equal(s.pendingTriggers.length, 1);
});
test('first target history exists without the ability; a new incarnation resets it', () => {
  const s = fixture(),
    o = put(s, 'Grizzly Bears');
  ping(s, o);
  o.definitionOverride = structuredClone(CARDS['Seedglaive Mentor']);
  ping(s, o);
  assert.equal(s.pendingTriggers.length, 0);
  move(s, o, 'exile');
  move(s, o, 'battlefield');
  ping(s, o);
  assert.equal(s.pendingTriggers.length, 1);
});
test('once-per-turn is per permanent and ability, consumed even when pending triggers are removed', () => {
  const s = fixture(),
    triggers = [
      { event: targeted, oncePerTurn: true, optional: true, effects: draw },
      { event: targeted, oncePerTurn: true, effects: draw },
    ];
  const a = custom(s, 'Limited watcher', triggers),
    b = put(s, a.name);
  ping(s, a);
  assert.equal(s.pendingTriggers.length, 2);
  s.pendingTriggers = []; // Neither resolving nor choosing to use it rearms the trigger.
  ping(s, a);
  assert.equal(s.pendingTriggers.length, 0);
  ping(s, b);
  assert.equal(s.pendingTriggers.length, 2);
  s.pendingTriggers = [];
  s.turn++;
  ping(s, a);
  assert.equal(s.pendingTriggers.length, 2);
});
test('object controller and targeting controller predicates are independent', () => {
  const s = fixture();
  custom(s, 'Friendly observer', [
    {
      event: {
        event: 'targeted',
        controller: 'you',
        targetingController: 'opponent',
        filter: { type: 'creature' },
      },
      effects: draw,
    },
  ]);
  const mine = put(s, 'Grizzly Bears'),
    theirs = put(s, 'Grizzly Bears', 1);
  ping(s, theirs, 0);
  ping(s, mine, 0);
  assert.equal(s.pendingTriggers.length, 0);
  ping(s, mine, 1);
  assert.equal(s.pendingTriggers.length, 1);
});
test('distinct group targets trigger once each, repeated references and omitted incarnation do not duplicate ward', () => {
  const s = fixture();
  const a = custom(
    s,
    'Ward watcher',
    [
      {
        event: { event: 'targeted', object: 'source', targetingController: 'opponent' },
        effects: draw,
      },
    ],
    { ward: { mana: { generic: 1 } } },
  );
  const b = put(s, a.name);
  notifyTargeted(s, {
    id: 'spell',
    kind: 'spell',
    controller: 1,
    targetGroups: [{}],
    targets: { a: [ref(a), ref(b)], b: [{ kind: 'object', id: a.id }] },
  });
  assert.equal(s.pendingTriggers.length, 4);
  assert.equal(s.pendingTriggers.filter((t) => t.label.endsWith('ward')).length, 2);
});
test('activation targets trigger before its own sacrifice cost and capture last known event power', () => {
  let s = fixture();
  const o = custom(
    s,
    'Sacrificial watcher',
    [{ event: targeted, effects: [{ op: 'damageEventPowerOpponent' }] }],
    {
      activated: [
        {
          cost: { sacrificeSelf: true },
          target: 'creature',
          effects: [],
          text: 'Sacrifice: target creature.',
        },
      ],
    },
  );
  o.plusCounters = 3;
  s = act(s, 'activate', { card: o.id, ability: 0, target: ref(o) });
  assert.equal(s.objects[o.id].zone, 'graveyard');
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).eventSource.power, 5);
  s = resolve(s);
  assert.equal(s.players[1].life, 15);
});
test('failed casting is atomic: no target history, queued triggers, events or identities leak', () => {
  const s = fixture(),
    mouse = put(s, 'Seedglaive Mentor'),
    spell = put(s, 'Giant Growth', 0, 'hand');
  const before = JSON.stringify(s);
  const result = dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(mouse) });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.objects[mouse.id].targetHistory, undefined);
  const hidden = put(s, 'Emberheart Challenger', 1);
  hidden.faceDown = true;
  ping(s, hidden);
  assert.equal(s.pendingTriggers.length, 1); // ward only; face-down text has no valiant/prowess
  const { catalog, ...view } = playerView(s, 0);
  assert.equal(JSON.stringify(view).includes('Emberheart Challenger'), false);
});
test('declining an optional limited trigger does not rearm it', () => {
  let s = fixture();
  const o = custom(
    s,
    'Optional watcher',
    [{ event: targeted, oncePerTurn: true, optional: true, effects: draw }],
    {
      activated: [{ cost: {}, target: 'creature', effects: [], text: 'Target creature.' }],
    },
  );
  s = act(s, 'activate', { card: o.id, ability: 0, target: ref(o) });
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  s = act(s, 'resolveOptional', { accept: false });
  s = act(s, 'activate', { card: o.id, ability: 0, target: ref(s.objects[o.id]) });
  assert.equal(s.stack.length, 2); // Both activations remain, but no second trigger.
});
test('target kind first-event histories distinguish spells and abilities without conflating valiant', () => {
  const s = fixture();
  const o = custom(s, 'Ability-first watcher', [
    { event: { ...targeted, targetingKind: 'ability', firstEachTurn: true }, effects: draw },
  ]);
  ping(s, o, 0, 'spell');
  assert.equal(s.pendingTriggers.length, 0);
  ping(s, o, 0, 'ability');
  assert.equal(s.pendingTriggers.length, 1);
  ping(s, o, 0, 'ability');
  assert.equal(s.pendingTriggers.length, 1);
});
test('a once-per-turn death observer persists its limit beyond a departure snapshot', () => {
  const s = fixture();
  const watcher = custom(s, 'Death observer', [
    { event: 'otherCreatureDies', oncePerTurn: true, effects: draw },
  ]);
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  move(s, a, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
  move(s, b, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
  assert.ok(s.objects[watcher.id].triggerUses[0]);
});
