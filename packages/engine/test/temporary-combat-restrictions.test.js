import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  canBlock,
  legalActions,
  dispatch,
  chooseBotCommand,
} from '../src/index.js';
import {
  copiableDefinition,
  definition,
  keywords,
  move,
  ref,
  notifyTriggers,
} from '../src/model.js';
import { resolveEffects, stabilize } from '../src/effects.js';
import {
  declareAttackers,
  declareBlockers,
  beginDamage,
  assignDamage,
  suggestedDamage,
} from '../src/combat.js';
import { finishCleanup } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { combatRestrictionScore } from '../src/trick-policy.js';
const restrict = (restriction = 'cannotBeBlocked', extra = {}) => ({
  op: 'combatRestriction',
  restriction,
  ...extra,
});
function apply(s, target, restriction = 'cannotBeBlocked') {
  resolveEffects(s, {
    controller: 0,
    source: ref(target),
    target: ref(target),
    effects: [restrict(restriction)],
  });
}

test('temporary blocking restrictions are rule effects, not abilities or copiable values; expire at cleanup', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  const copied = structuredClone(copiableDefinition(s, a)),
    printed = definition(s, a),
    beforeKeywords = keywords(s, a);
  assert.equal(canBlock(s, b, a, 1), true);
  apply(s, a);
  assert.equal(canBlock(s, b, a, 1), false);
  assert.deepEqual(copiableDefinition(s, a), copied);
  assert.deepEqual(definition(s, a), printed);
  assert.deepEqual(keywords(s, a), beforeKeywords);
  finishCleanup(s);
  assert.equal(s.modifiers.length, 0);
  assert.equal(canBlock(s, b, a, 1), true);
});

test('restriction targets exact incarnation, does not follow blink or affect copies, and stacks independently', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1),
    copy = put(s, 'Grizzly Bears');
  apply(s, a);
  apply(s, b, 'cannotBlock');
  assert.equal(canBlock(s, b, copy, 1), false);
  move(s, b, 'exile');
  move(s, b, 'battlefield');
  assert.equal(canBlock(s, b, copy, 1), true);
  assert.equal(canBlock(s, b, a, 1), false);
  move(s, a, 'exile');
  move(s, a, 'battlefield');
  assert.equal(canBlock(s, b, a, 1), true);
});

test('cannot-block restrictions reject declarations, but later restrictions never undo existing blocks', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  declareAttackers(s, [a.id]);
  apply(s, b, 'cannotBlock');
  assert.throws(() => declareBlockers(s, [{ attacker: a.id, blocker: b.id }]), /not legal/);
  s.modifiers = [];
  declareBlockers(s, [{ attacker: a.id, blocker: b.id }]);
  apply(s, a);
  apply(s, b, 'cannotBlock');
  const blocks = structuredClone(s.combat.blocks);
  s.step = 'damage';
  beginDamage(s, false);
  if (s.choice?.kind === 'damage') assignDamage(s, suggestedDamage(s));
  assert.equal(s.players[1].life, 20);
  assert.deepEqual(s.combat.blocks, blocks);
  assert.ok(s.combat.blocked.includes(a.id));
});

test('Smuggler enforces other/power constraints, rechecks target on resolution, and does not recheck power afterwards', () => {
  let s = fixture();
  const smuggler = put(s, 'Goblin Smuggler'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: smuggler.id,
      ability: 0,
      target: ref(smuggler),
    }).ok,
    false,
  );
  s = act(s, 'activate', { card: smuggler.id, ability: 0, target: ref(a) });
  s = resolve(s);
  s.objects[a.id].plusCounters = 5;
  assert.equal(canBlock(s, s.objects[b.id], s.objects[a.id], 1), false);
  s.objects[smuggler.id].tapped = false;
  s.objects[a.id].plusCounters = 0;
  s.modifiers = [];
  s = act(s, 'activate', { card: smuggler.id, ability: 0, target: ref(a) });
  s.objects[a.id].plusCounters = 1;
  s = resolve(s);
  assert.equal(canBlock(s, s.objects[b.id], s.objects[a.id], 1), true);
});

test('Clammy Prowler attack trigger selects only other attacking creatures', () => {
  let s = fixture();
  const prowler = put(s, 'Clammy Prowler'),
    a = put(s, 'Grizzly Bears');
  put(s, 'Grizzly Bears');
  const b = put(s, 'Grizzly Bears', 1);
  declareAttackers(s, [prowler.id, a.id]);
  stabilize(s);
  assert.deepEqual(s.choice.targets, [ref(a)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(a) });
  s = resolve(s);
  assert.equal(canBlock(s, s.objects[b.id], s.objects[a.id], 1), false);
  assert.equal(canBlock(s, s.objects[b.id], s.objects[prowler.id], 1), true);
});

test('Duel Tactics deals damage and denies blocking, including flashback', () => {
  for (const zone of ['hand', 'graveyard']) {
    let s = fixture();
    lands(s, 'Mountain', 2);
    const spell = put(s, 'Duel Tactics', 0, zone),
      a = put(s, 'Grizzly Bears'),
      b = put(s, 'Grizzly Bears', 1);
    const command = legalActions(s, 0).find(
      (c) => c.type === 'cast' && c.card === spell.id && c.target?.id === b.id,
    );
    assert.ok(command);
    const result = dispatch(s, { ...command, player: 0 });
    assert.equal(result.ok, true);
    s = resolve(result.state);
    assert.equal(s.objects[b.id].damage, 1);
    assert.equal(canBlock(s, s.objects[b.id], s.objects[a.id], 1), false);
    assert.equal(s.objects[spell.id].zone, zone === 'graveyard' ? 'exile' : 'graveyard');
  }
});

test('grouped restrictions resolve for surviving targets only', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Restriction fixture': {
      name: 'Restriction fixture',
      type: 'sorcery',
      cost: {},
      targetGroups: [{ id: 'creatures', selector: 'creature', min: 1, max: 2 }],
      effects: [restrict('cannotBeBlocked', { targetGroup: 'creatures' })],
    },
  });
  const card = put(s, 'Restriction fixture', 0, 'hand'),
    a = put(s, 'Grizzly Bears'),
    other = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: card.id, targets: { creatures: [ref(a), ref(other)] } });
  move(s, s.objects[other.id], 'hand');
  s = resolve(s);
  assert.equal(canBlock(s, s.objects[b.id], s.objects[a.id], 1), false);
  assert.equal(s.modifiers.length, 1);
});

test('restriction definitions fail closed for unknown modes, illegal bindings, targets, and fake keywords', () => {
  const base = {
    name: 'Restriction fixture',
    type: 'sorcery',
    cost: {},
    target: 'creature',
    effects: [restrict()],
  };
  assert.doesNotThrow(() => createRegistry({ [base.name]: base }));
  for (const bad of [
    { ...base, effects: [restrict('flying')] },
    { ...base, effects: [restrict('cannotBlock', { subject: 'opponent' })] },
    { ...base, target: 'player' },
    { ...base, keywords: ['unblockable'] },
  ])
    assert.throws(() => createRegistry({ [base.name]: bad }));
});

test('bot activates evasive abilities before blockers and holds them after declaration', () => {
  const s = fixture(),
    source = put(s, "Elvenking's Harper"),
    a = put(s, 'Grizzly Bears');
  lands(s, 'Island', 5);
  put(s, 'Centaur Courser', 1);
  s.step = 'attackers';
  s.combat.attackers = [ref(a)];
  const action = chooseBotCommand(s, 0);
  assert.equal(action.type, 'activate');
  assert.equal(action.card, source.id);
  assert.equal(action.target.id, a.id);
  s.step = 'blockers';
  assert.equal(combatRestrictionScore(s, 0, action), -100);
});

test('self restrictions from second-spell triggers use exact source', () => {
  const s = fixture(),
    a = put(s, 'Razzle-Dazzler'),
    b = put(s, 'Grizzly Bears', 1);
  s.players[0].spellsCast = { turn: s.turn, profiles: [{ definition: CARDS.Shock, count: 2 }] };
  notifyTriggers(s, 'cast', { player: 0, spellNumber: 2, object: put(s, 'Shock', 0, 'hand') });
  stabilize(s);
  assert.ok(s.stack.length);
  const result = resolve(s);
  assert.equal(result.objects[a.id].plusCounters, 1);
  assert.equal(canBlock(result, result.objects[b.id], result.objects[a.id], 1), false);
});

test('Gateway Sneak triggers for a Gate controlled by its controller, not another land', () => {
  const s = fixture(),
    a = put(s, 'Gateway Sneak'),
    b = put(s, 'Grizzly Bears', 1),
    land = put(s, 'Island');
  notifyTriggers(s, 'enter', { object: land });
  stabilize(s);
  assert.equal(s.stack.length, 0);
  land.definitionOverride = { ...CARDS.Island, subtypes: ['Gate'] };
  notifyTriggers(s, 'enter', { object: land });
  stabilize(s);
  assert.equal(s.stack.length, 1);
  const result = resolve(s);
  assert.equal(canBlock(result, result.objects[b.id], result.objects[a.id], 1), false);
});

test('Escape Tunnel restriction resolves even after sacrificing its source', () => {
  let s = fixture();
  const source = put(s, 'Escape Tunnel'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  s = act(s, 'activate', { card: source.id, ability: 1, target: ref(a) });
  assert.equal(s.objects[source.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(canBlock(s, s.objects[b.id], s.objects[a.id], 1), false);
});

test('controller-restricted activations reject opponents, while Smuggler can target either side', () => {
  for (const name of [
    "Deserter's Disciple",
    'Eardrum Rattler',
    'Apocalypse Runner',
    'Underfoot Underdogs',
  ]) {
    const s = fixture(),
      source = put(s, name),
      a = put(s, 'Grizzly Bears'),
      b = put(s, 'Grizzly Bears', 1);
    lands(s, 'Mountain', 1);
    const proposals = legalActions(s, 0).filter(
      (c) => c.type === 'activate' && c.card === source.id && c.ability === 0,
    );
    assert.ok(
      proposals.some((c) => c.target?.id === a.id),
      name,
    );
    assert.ok(!proposals.some((c) => c.target?.id === b.id), name);
  }
});

test('Sandstorm Verge sorcery timing and Gearseeker affinity remain intact', () => {
  let s = fixture();
  const source = put(s, 'Sandstorm Verge'),
    a = put(s, 'Grizzly Bears', 1);
  lands(s, 'Mountain', 3);
  s.step = 'attackers';
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, target: ref(a) }).ok,
    false,
  );
  s.step = 'main1';
  s = act(s, 'activate', { card: source.id, ability: 0, target: ref(a) });
  s = resolve(s);
  assert.ok(s.modifiers.some((m) => m.objectId === a.id && m.combatRestriction === 'cannotBlock'));
  const t = fixture();
  lands(t, 'Island', 2);
  for (let i = 0; i < 5; i++)
    put(t, 'Goblin Token').definitionOverride = {
      ...CARDS['Goblin Token'],
      type: 'artifact',
      types: ['artifact', 'creature'],
    };
  const serpent = put(t, 'Gearseeker Serpent', 0, 'hand');
  assert.ok(legalActions(t, 0).some((c) => c.type === 'cast' && c.card === serpent.id));
});
