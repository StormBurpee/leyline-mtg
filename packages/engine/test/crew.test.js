import test from 'node:test';
import assert from 'node:assert/strict';
import {
  definition,
  stats,
  hasType,
  canAttack,
  canBlock,
  canTapForMana,
  crewProblem,
  crewCandidates,
  legalActions,
  dispatch,
  chooseBotCommand,
  ref,
  validateDefinition,
} from '../src/index.js';
import { move } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';

function setup(name = 'Skybox Ferry', ready = true) {
  const s = fixture(),
    vehicle = put(s, name, 0, 'battlefield', { ready });
  const a = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false });
  return { s, vehicle, a };
}
function crew(s, vehicle, cards) {
  return act(s, 'crew', { card: vehicle.id, cards: cards.map((o) => o.id) });
}

test('printed P/T is not a creature; crew taps sick creatures immediately and animates only on resolution', () => {
  let { s, vehicle, a } = setup();
  assert.equal(hasType(definition(s, vehicle), 'creature'), false);
  assert.equal(canAttack(s, vehicle, 0), false);
  assert.equal(stats(s, vehicle).power, 0);
  s = crew(s, vehicle, [a]);
  assert.equal(s.objects[a.id].tapped, true);
  assert.equal(s.objects[vehicle.id].tapped, false);
  assert.equal(hasType(definition(s, s.objects[vehicle.id]), 'creature'), false);
  assert.equal(s.stack.at(-1).kind, 'ability');
  s = resolve(s);
  assert.deepEqual(definition(s, s.objects[vehicle.id]).types, ['artifact', 'creature']);
  assert.equal(canAttack(s, s.objects[vehicle.id], 0), true);
  assert.equal(stats(s, s.objects[vehicle.id]).toughness, 4);
  s.step = 'end';
  s = resolve(s);
  assert.equal(hasType(definition(s, s.objects[vehicle.id]), 'creature'), false);
});

test('crew cost rejects duplicate, self, tapped, opposing, noncreature, unknown and insufficient crews atomically', () => {
  let { s, vehicle, a } = setup("Cultivator's Caravan");
  const enemy = put(s, 'Grizzly Bears', 1),
    land = put(s, 'Forest'),
    tapped = put(s, 'Grizzly Bears');
  tapped.tapped = true;
  for (const cards of [
    [a.id],
    [a.id, a.id],
    [vehicle.id],
    [enemy.id],
    [land.id],
    [tapped.id],
    ['bogus'],
    null,
  ]) {
    const result = dispatch(s, { type: 'crew', player: 0, card: vehicle.id, cards });
    assert.equal(result.ok, false, JSON.stringify(cards));
    assert.equal(s.objects[a.id].tapped, false);
    assert.equal(s.stack.length, 0);
  }
  const b = put(s, 'Grizzly Bears');
  s = resolve(crew(s, vehicle, [a, b]));
  assert.match(crewProblem(s, 0, vehicle.id, [vehicle.id]), /other untapped/);
  assert.equal(
    crewCandidates(s, 0, vehicle.id).some((o) => o.id === vehicle.id),
    false,
  );
});

test('current power includes counters/bonuses; overpayment and zero/negative power crew members are legal', () => {
  let { s, vehicle, a } = setup("Cultivator's Caravan");
  const b = put(s, 'Ornithopter');
  a.plusCounters = 1;
  s.modifiers.push({
    objectId: b.id,
    incarnation: b.incarnation,
    power: -1,
    toughness: 0,
    expires: s.turn,
  });
  assert.match(crewProblem(s, 0, vehicle.id, [a.id, b.id]), /insufficient/);
  a.plusCounters = 2;
  assert.equal(crewProblem(s, 0, vehicle.id, [a.id, b.id]), null);
  s = crew(s, vehicle, [a, b]);
  assert.equal(s.objects[b.id].tapped, true);
});

test('newly entered vehicles retain sickness after animation, can block, and lose mana tap availability', () => {
  let { s, vehicle, a } = setup("Cultivator's Caravan", false);
  const b = put(s, 'Grizzly Bears');
  assert.equal(canTapForMana(s, vehicle, 0), true);
  s = resolve(crew(s, vehicle, [a, b]));
  assert.equal(canAttack(s, s.objects[vehicle.id], 0), false);
  assert.equal(canTapForMana(s, s.objects[vehicle.id], 0), false);
  const attacker = put(s, 'Grizzly Bears', 1);
  assert.equal(canBlock(s, s.objects[vehicle.id], attacker, 0), true);
});

test('crew resolves independently of crew creatures and never animates a new source incarnation', () => {
  let { s, vehicle, a } = setup();
  s = crew(s, vehicle, [a]);
  move(s, s.objects[a.id], 'graveyard');
  s = resolve(s);
  assert.equal(definition(s, s.objects[vehicle.id]).type, 'creature');
  move(s, s.objects[vehicle.id], 'hand');
  move(s, s.objects[vehicle.id], 'battlefield');
  assert.equal(definition(s, s.objects[vehicle.id]).type, 'artifact');
  const b = put(s, 'Grizzly Bears');
  s = crew(s, vehicle, [b]);
  move(s, s.objects[vehicle.id], 'hand');
  move(s, s.objects[vehicle.id], 'battlefield');
  s = resolve(s);
  assert.equal(definition(s, s.objects[vehicle.id]).type, 'artifact');
});

test('repeated activations are legal while tapped/already animated, and animation is not entering', () => {
  let { s, vehicle, a } = setup('Air Response Unit');
  const second = put(s, 'Grizzly Bears');
  s = resolve(crew(s, vehicle, [a]));
  s.objects[vehicle.id].tapped = true;
  s = resolve(crew(s, vehicle, [second]));
  assert.equal(s.objects[vehicle.id].tapped, true);
  assert.equal(s.modifiers.filter((m) => m.addTypes).length, 2);
  assert.equal(s.events.filter((e) => e.type === 'enter').length, 0);
});

test('animation receives creature anthems and creature-only removal/lethal damage state checks', () => {
  let { s, vehicle, a } = setup();
  put(s, 'Glorious Anthem');
  assert.equal(stats(s, vehicle).power, 0);
  s = resolve(crew(s, vehicle, [a]));
  assert.equal(stats(s, s.objects[vehicle.id]).power, 5);
  s.objects[vehicle.id].damage = 5;
  stabilize(s);
  assert.equal(s.objects[vehicle.id].zone, 'graveyard');
});

test('bot crews before attacks without repeated activation loops; action enumeration gives a legal bounded witness', () => {
  let { s, vehicle } = setup();
  s.step = 'beginCombat';
  const action = chooseBotCommand(s, 0);
  assert.equal(action.type, 'crew');
  assert.equal(crewProblem(s, 0, action.card, action.cards), null);
  s = act(s, 'crew', action);
  assert.notEqual(chooseBotCommand(s, 0)?.type, 'crew');
  s = resolve(s);
  assert.notEqual(chooseBotCommand(s, 0)?.type, 'crew');
  assert.equal(canAttack(s, s.objects[vehicle.id], 0), true);
});

test('crew definitions fail closed for malformed costs and unsupported creature/disguise/star-stat combinations', () => {
  const { s, vehicle } = setup();
  const d = definition(s, vehicle);
  for (const bad of [
    { crew: -1 },
    { crew: 1.5 },
    { power: '*' },
    { types: ['artifact', 'creature'], type: 'creature' },
    { subtypes: [] },
    { disguise: { generic: 2 } },
    { baseStats: { power: 1 } },
  ])
    assert.ok(validateDefinition({ ...d, ...bad }).length, JSON.stringify(bad));
});

test('P/T modifications made before animation remain dormant, then apply to the same incarnation', () => {
  let { s, vehicle, a } = setup();
  s.modifiers.push({
    objectId: vehicle.id,
    incarnation: vehicle.incarnation,
    power: 2,
    toughness: 3,
    expires: s.turn,
  });
  vehicle.plusCounters = 1;
  assert.deepEqual(stats(s, vehicle), { power: 0, toughness: 0 });
  s = resolve(crew(s, vehicle, [a]));
  assert.deepEqual(stats(s, s.objects[vehicle.id]), { power: 7, toughness: 8 });
  s.step = 'end';
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[vehicle.id]), { power: 0, toughness: 0 });
  // Counters persist; the turn-bound modifier does not.
  s.active = 0;
  s.priority = 0;
  s.choice = null;
  s.step = 'main1';
  const b = put(s, 'Grizzly Bears');
  s = resolve(crew(s, vehicle, [b]));
  assert.deepEqual(stats(s, s.objects[vehicle.id]), { power: 5, toughness: 5 });
});

test('crew zero accepts an empty cost; unavailable priority and face-down sources fail closed', () => {
  let { s, vehicle } = setup();
  vehicle.definitionOverride = { ...definition(s, vehicle), crew: 0 };
  assert.equal(crewProblem(s, 0, vehicle.id, []), null);
  s = resolve(act(s, 'crew', { card: vehicle.id, cards: [] }));
  assert.equal(definition(s, s.objects[vehicle.id]).type, 'creature');
  s.priority = 1;
  assert.match(crewProblem(s, 0, vehicle.id, []), /priority/);
  s.priority = 0;
  s.objects[vehicle.id].faceDown = true;
  assert.match(crewProblem(s, 0, vehicle.id, []), /permanent with crew/);
});

test('CR 208.3 preserves printed Vehicle P/T outside the battlefield, including search, graveyard and spell selectors', async () => {
  const { searchableCards } = await import('../src/library-search.js');
  const { legalTarget } = await import('../src/effects.js');
  let s = fixture();
  for (const zone of ['hand', 'library', 'graveyard', 'exile', 'stack']) {
    const vehicle = put(s, 'Skybox Ferry', 0, zone);
    assert.deepEqual(stats(s, vehicle), { power: 4, toughness: 4 }, zone);
    if (zone === 'library')
      assert.ok(searchableCards(s, 0, { power: { eq: 4 } }).includes(vehicle.id));
    if (zone === 'graveyard')
      assert.equal(
        legalTarget(s, { scope: 'graveyard', where: { power: { eq: 4 } } }, ref(vehicle), 0),
        true,
      );
    if (zone === 'stack') {
      s.stack.push({ id: 'test-spell', kind: 'spell', controller: 0, source: ref(vehicle) });
      assert.equal(
        legalTarget(
          s,
          { scope: 'spell', where: { power: { eq: 4 } } },
          { kind: 'stack', id: 'test-spell' },
          0,
        ),
        true,
      );
    }
  }
});
