import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  chooseBotCommand,
  createRegistry,
  createGame,
  dispatch,
  stats,
  hasKeyword,
  exportReplay,
  replay,
} from '../src/index.js';
import { move, ref } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { finishCleanup } from '../src/turn.js';
import { meetsCondition } from '../src/conditions.js';
import { fixture, put, act, resolve } from './helpers.js';
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const modifier = (s, o, fields) =>
  s.modifiers.push({ objectId: o.id, incarnation: o.incarnation, expires: s.turn, ...fields });
const cast = (s, name, args = {}) => {
  const card = put(s, name, 0, 'hand');
  return { state: resolve(act(s, 'cast', { card: card.id, ...args })), id: card.id };
};
const tokens = (s, name) =>
  Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === name && o.token);
const selfTarget = (where) => ({ kind: 'targetMatches', target: 'target', where });
const customSpell = (s, effects, target = 'creature') => {
  const d = { name: 'Target condition fixture', type: 'instant', cost: {}, target, effects };
  s.catalog = createRegistry({ ...s.catalog, [d.name]: d });
  return d.name;
};

test('Malamet Battle Glyph checks entry turn at resolution, counters first, and then fights', () => {
  for (const entered of [false, true]) {
    let s = rich();
    const actor = put(s, 'Grizzly Bears'),
      victim = put(s, 'Hill Giant', 1);
    actor.enteredTurn = entered ? s.turn : s.turn - 1;
    modifier(s, actor, { toughness: 10 });
    s = cast(s, 'Malamet Battle Glyph', {
      targets: { actor: [ref(actor)], victim: [ref(victim)] },
    }).state;
    assert.equal(s.objects[actor.id].plusCounters, entered ? 1 : 0);
    assert.equal(s.objects[actor.id].damage, 3);
    assert.equal(s.objects[victim.id].zone, entered ? 'graveyard' : 'battlefield');
    assert.equal(
      s.events.filter((e) => e.type === 'damage' && e.source === actor.id).at(-1).amount,
      entered ? 3 : 2,
    );
  }
});
test('Throw from the Saddle reads current Mount type, grants only a counter or a temporary bonus, and bites', () => {
  for (const mount of [false, true]) {
    let s = rich();
    const actor = put(s, 'Grizzly Bears'),
      victim = put(s, 'Hill Giant', 1);
    const card = put(s, 'Throw from the Saddle', 0, 'hand');
    s = act(s, 'cast', { card: card.id, targets: { actor: [ref(actor)], victim: [ref(victim)] } });
    if (mount)
      s.objects[actor.id].definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: ['Mount'] };
    s = resolve(s);
    assert.equal(s.objects[actor.id].plusCounters, mount ? 1 : 0);
    assert.deepEqual(stats(s, s.objects[actor.id]), { power: 3, toughness: 3 });
    assert.equal(s.objects[actor.id].damage, 0);
    assert.equal(s.objects[victim.id].zone, 'graveyard');
    finishCleanup(s);
    assert.equal(stats(s, s.objects[actor.id]).power, mount ? 3 : 2);
  }
});
test('partial target resolution retains an actor bonus but never reads an illegal or returned actor', () => {
  for (const name of ['Malamet Battle Glyph', 'Throw from the Saddle'])
    for (const failure of [
      'victimGone',
      'actorGone',
      'actorReturned',
      'actorChangedControl',
      'actorShroud',
    ]) {
      let s = rich();
      const actor = put(s, 'Grizzly Bears'),
        victim = put(s, 'Hill Giant', 1);
      const card = put(s, name, 0, 'hand');
      s = act(s, 'cast', {
        card: card.id,
        targets: { actor: [ref(actor)], victim: [ref(victim)] },
      });
      if (failure === 'victimGone') move(s, s.objects[victim.id], 'hand');
      else if (failure === 'actorChangedControl') s.objects[actor.id].controller = 1;
      else if (failure === 'actorShroud')
        modifier(s, s.objects[actor.id], { keywords: ['shroud'] });
      else {
        move(s, s.objects[actor.id], 'hand');
        if (failure === 'actorReturned') move(s, s.objects[actor.id], 'battlefield');
      }
      s = resolve(s);
      assert.equal(
        stats(s, s.objects[actor.id]).power,
        failure === 'victimGone' ? 3 : 2,
        `${name} ${failure}`,
      );
      assert.equal(s.events.filter((e) => e.type === 'damage' && e.source === actor.id).length, 0);
      assert.equal(s.objects[victim.id].damage, 0);
    }
});
test('invalid grouped declarations reject atomically, and losing every target fizzles the whole spell', () => {
  let s = rich();
  const actor = put(s, 'Grizzly Bears'),
    victim = put(s, 'Hill Giant', 1),
    card = put(s, 'Malamet Battle Glyph', 0, 'hand');
  for (const targets of [
    { actor: [], victim: [ref(victim)] },
    { actor: [ref(victim)], victim: [ref(actor)] },
    { actor: [ref(actor)], victim: [{ kind: 'player', id: 1 }] },
  ]) {
    const before = structuredClone(s);
    assert.equal(dispatch(s, { type: 'cast', player: 0, card: card.id, targets }).ok, false);
    assert.deepEqual(s, before);
  }
  s = act(s, 'cast', { card: card.id, targets: { actor: [ref(actor)], victim: [ref(victim)] } });
  move(s, s.objects[actor.id], 'hand');
  move(s, s.objects[victim.id], 'hand');
  s = resolve(s);
  assert.equal(s.events.filter((e) => e.type === 'fizzled' && e.name === card.name).length, 1);
});
test('Depressurize evaluates effective power after its own -3/-0, including negative power and indestructible', () => {
  for (const [power, indestructible] of [
    [-1, false],
    [2, false],
    [3, false],
    [4, false],
    [3, true],
  ]) {
    let s = rich();
    const target = put(s, 'Hill Giant', 1);
    modifier(s, target, {
      power: power - 3,
      ...(indestructible ? { keywords: ['indestructible'] } : {}),
    });
    s = cast(s, 'Depressurize', { target: ref(target) }).state;
    assert.equal(
      s.objects[target.id].zone,
      power <= 3 && !indestructible ? 'graveyard' : 'battlefield',
    );
    if (s.objects[target.id].zone === 'battlefield')
      assert.equal(stats(s, s.objects[target.id]).power, power - 3);
  }
});
test('a condition does not retarget between instructions, and it never consults a departed incarnation', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears', 1);
  const name = customSpell(s, [
    { op: 'modify', power: 0, toughness: 0, keywords: ['hexproof'] },
    {
      op: 'conditional',
      condition: selfTarget({ power: { eq: 2 } }),
      then: [{ op: 'gainLife', amount: 1 }],
    },
  ]);
  s = cast(s, name, { target: ref(target) }).state;
  assert.equal(s.players[0].life, 21);
  s = rich();
  const second = put(s, 'Grizzly Bears', 1);
  const gone = customSpell(s, [
    { op: 'moveTarget', destination: 'exile' },
    {
      op: 'conditional',
      condition: selfTarget({ type: 'creature' }),
      then: [{ op: 'gainLife', amount: 4 }],
    },
  ]);
  s = cast(s, gone, { target: ref(second) }).state;
  assert.equal(s.players[0].life, 20);
});
test('missing, hidden, stale, illegal, and noncreature-stat targets fail closed; face-down characteristics stay public', () => {
  const s = rich(),
    target = put(s, 'Grizzly Bears', 1),
    context = { targetKind: 'creature', target: ref(target) };
  assert.equal(meetsCondition(s, 0, selfTarget({ power: { eq: 2 } }), [], null, context), true);
  assert.equal(
    meetsCondition(s, 0, selfTarget({ not: { type: 'creature' } }), [], null, {}),
    false,
  );
  modifier(s, target, { keywords: ['hexproof'] });
  assert.equal(meetsCondition(s, 0, selfTarget({ type: 'creature' }), [], null, context), false);
  s.modifiers = [];
  target.hidden = true;
  assert.equal(meetsCondition(s, 0, selfTarget({ type: 'creature' }), [], null, context), false);
  delete target.hidden;
  move(s, target, 'hand');
  move(s, target, 'battlefield');
  assert.equal(meetsCondition(s, 0, selfTarget({ type: 'creature' }), [], null, context), false);
  target.faceDown = true;
  const publicContext = { targetKind: 'creature', target: ref(target) };
  assert.equal(
    meetsCondition(s, 0, selfTarget({ subtype: 'Bear' }), [], null, publicContext),
    false,
  );
  assert.equal(
    meetsCondition(s, 0, selfTarget({ name: 'Grizzly Bears' }), [], null, publicContext),
    false,
  );
  assert.equal(
    meetsCondition(s, 0, selfTarget({ manaValue: { eq: 0 } }), [], null, publicContext),
    true,
  );
  const artifact = put(s, 'Basilisk Collar');
  assert.equal(
    meetsCondition(s, 0, selfTarget({ power: { eq: 0 } }), [], null, {
      targetKind: 'artifact',
      target: ref(artifact),
    }),
    false,
  );
});
test('Wisecrack self-damage uses creature power and keywords; attacking follow-through uses the spell as source before SBAs', () => {
  for (const attacking of [false, true]) {
    let s = rich();
    const target = put(s, 'Hill Giant', 1);
    modifier(s, target, { power: 1, keywords: ['lifelink'] });
    if (attacking) s.combat = { attackers: [ref(target)], blocks: {}, defender: 0 };
    const result = cast(s, 'Wisecrack', { targets: { creature: [ref(target)] } });
    s = result.state;
    assert.equal(s.objects[target.id].zone, 'graveyard');
    assert.equal(s.players[1].life, attacking ? 22 : 24);
    const selfDamage = s.events.find((e) => e.type === 'damage' && e.source === target.id);
    assert.equal(selfDamage.amount, 4);
    const follow = s.events.filter((e) => e.type === 'damage' && e.source === result.id);
    assert.equal(follow.length, attacking ? 1 : 0);
    if (attacking) assert.equal(follow[0].amount, 2);
  }
});
test('Wisecrack rechecks attacking state and controller, and an illegal creature never damages its controller', () => {
  for (const change of ['stopAttacking', 'changeController', 'hexproof']) {
    let s = rich();
    const target = put(s, 'Grizzly Bears', 1),
      card = put(s, 'Wisecrack', 0, 'hand');
    s.combat = { attackers: [ref(target)], blocks: {}, defender: 0 };
    s = act(s, 'cast', { card: card.id, targets: { creature: [ref(target)] } });
    if (change === 'stopAttacking') s.combat.attackers = [];
    else if (change === 'changeController') s.objects[target.id].controller = 0;
    else modifier(s, s.objects[target.id], { keywords: ['hexproof'] });
    s = resolve(s);
    assert.equal(s.players[1].life, 20);
    assert.equal(s.players[0].life, change === 'changeController' ? 18 : 20);
  }
});
test('Seedship Impact and Tainted Treats snapshot mana value immediately before destruction, not destruction success', () => {
  for (const [name, limit, token] of [
    ['Seedship Impact', 2, 'Lander Token'],
    ['Tainted Treats', 4, 'Food Token'],
  ])
    for (const [mv, indestructible] of [
      [limit, false],
      [limit + 1, false],
      [limit, true],
    ]) {
      let s = rich();
      const target = put(s, 'Basilisk Collar', 1);
      target.definitionOverride = { ...CARDS['Basilisk Collar'], cost: { generic: mv } };
      if (indestructible) modifier(s, target, { keywords: ['indestructible'] });
      s = cast(s, name, { target: ref(target) }).state;
      assert.equal(s.objects[target.id].zone, indestructible ? 'battlefield' : 'graveyard');
      assert.equal(tokens(s, token).length, mv <= limit ? 1 : 0);
    }
});
test('Brackish Blunder observes tapped status before returning the creature, including tokens', () => {
  for (const [name, tapped] of [
    ['Grizzly Bears', false],
    ['Grizzly Bears', true],
    ['Beast Token', true],
  ]) {
    let s = rich();
    const target = put(s, name, 1);
    target.tapped = tapped;
    s = cast(s, 'Brackish Blunder', { target: ref(target) }).state;
    assert.equal(s.objects[target.id]?.zone, name === 'Beast Token' ? undefined : 'hand');
    assert.equal(tokens(s, 'Map Token').length, tapped ? 1 : 0);
  }
});
test('Budding Insurgent sacrifices as its cost, enforces sorcery timing, and draws only for a legendary enchantment', () => {
  for (const legendary of [false, true]) {
    let s = rich();
    const source = put(s, 'Budding Insurgent'),
      target = put(s, 'Glorious Anthem', 1);
    target.definitionOverride = { ...CARDS['Glorious Anthem'], legendary };
    assert.equal(hasKeyword(s, source, 'vigilance'), true);
    s.step = 'beginCombat';
    const before = structuredClone(s);
    assert.equal(
      dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, target: ref(target) })
        .ok,
      false,
    );
    assert.deepEqual(s, before);
    s.step = 'main1';
    const hand = s.players[0].hand.length;
    s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
    assert.equal(s.objects[source.id].zone, 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'graveyard');
    assert.equal(s.players[0].hand.length, hand + Number(legendary));
  }
});
test('Consuming Ashes uses public pre-exile mana value and preserves the surveil continuation', () => {
  for (const [name, faceDown, expected] of [
    ['Grizzly Bears', false, true],
    ['Colossal Dreadmaw', false, false],
    ['Colossal Dreadmaw', true, true],
  ]) {
    let s = rich();
    const target = put(s, name, 1);
    target.faceDown = faceDown;
    const result = cast(s, 'Consuming Ashes', { target: ref(target) });
    s = result.state;
    if (faceDown) {
      assert.equal(s.choice.reason, 'ward');
      s = act(s, 'payCost', { pay: true });
      s = resolve(s);
    }
    assert.equal(s.objects[target.id].zone, 'exile');
    if (expected) {
      assert.equal(s.choice.action, 'surveil');
      assert.equal(s.choice.cards.length, 2);
      s = act(s, 'orderLibrary', { top: [], rest: [...s.choice.cards] });
    } else assert.equal(s.choice, null);
    assert.equal(s.objects[result.id].zone, 'graveyard');
  }
});
test('Driftgloom Coyote checks pre-exile effective power and returns the same exiled card when it leaves', () => {
  for (const boost of [0, 1]) {
    let s = rich();
    const target = put(s, 'Grizzly Bears', 1);
    if (boost) modifier(s, target, { power: boost });
    const result = cast(s, 'Driftgloom Coyote');
    s = result.state;
    s = act(s, 'chooseTriggerTarget', { target: ref(target) });
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'exile');
    assert.equal(s.objects[result.id].plusCounters, boost ? 0 : 1);
    move(s, s.objects[result.id], 'hand');
    stabilize(s);
    assert.equal(s.objects[target.id].zone, 'battlefield');
  }
});
test('Scavenging Ooze accepts either graveyard and still gains life if its source has left', () => {
  for (const [name, owner, sourceGone] of [
    ['Grizzly Bears', 0, false],
    ['Grizzly Bears', 1, true],
    ['Forest', 1, false],
  ]) {
    let s = rich();
    const source = put(s, 'Scavenging Ooze'),
      target = put(s, name, owner, 'graveyard');
    s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
    if (sourceGone) move(s, s.objects[source.id], 'hand');
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'exile');
    assert.equal(
      s.objects[source.id].plusCounters,
      name === 'Grizzly Bears' && !sourceGone ? 1 : 0,
    );
    assert.equal(s.players[0].life, name === 'Grizzly Bears' ? 21 : 20);
  }
});
test('Little Bear selects targets after entering, untaps any other own creature and counters only a current Bear', () => {
  for (const name of ['Grizzly Bears', 'Hill Giant']) {
    let s = rich();
    const target = put(s, name);
    target.tapped = true;
    const result = cast(s, 'Little Bear');
    s = result.state;
    assert.equal(hasKeyword(s, s.objects[result.id], 'flash'), true);
    assert.equal(s.choice.kind, 'triggerTarget');
    const before = structuredClone(s);
    assert.equal(
      dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(s.objects[result.id]) }).ok,
      false,
    );
    assert.deepEqual(s, before);
    s = act(s, 'chooseTriggerTarget', { target: ref(target) });
    move(s, s.objects[result.id], 'hand');
    s = resolve(s);
    assert.equal(s.objects[target.id].tapped, false);
    assert.equal(s.objects[target.id].plusCounters, name === 'Grizzly Bears' ? 1 : 0);
  }
});
test('Yip Yip boosts every legal own creature but grants flying only to a current Ally', () => {
  for (const ally of [false, true]) {
    let s = rich();
    const target = put(s, 'Grizzly Bears');
    const card = put(s, 'Yip Yip!', 0, 'hand');
    s = act(s, 'cast', { card: card.id, target: ref(target) });
    if (ally)
      s.objects[target.id].definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: ['Ally'] };
    s = resolve(s);
    assert.equal(stats(s, s.objects[target.id]).power, 4);
    assert.equal(hasKeyword(s, s.objects[target.id], 'flying'), ally);
  }
});
test('Ingenious Leonin excludes itself and nonattackers, counters first, then checks the current Cat subtype', () => {
  for (const cat of [false, true]) {
    let s = rich();
    const source = put(s, 'Ingenious Leonin'),
      target = put(s, 'Grizzly Bears');
    s.combat = { attackers: [ref(source), ref(target)], blocks: {}, defender: 1 };
    s.step = 'declareBlockers';
    assert.equal(
      dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, target: ref(source) })
        .ok,
      false,
    );
    s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
    if (cat)
      s.objects[target.id].definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: ['Cat'] };
    move(s, s.objects[source.id], 'hand');
    s = resolve(s);
    assert.equal(s.objects[target.id].plusCounters, 1);
    assert.equal(hasKeyword(s, s.objects[target.id], 'first strike'), cat);
  }
});
test('Hazardroot Herbalist triggers once per attack group and grants deathtouch only to a targeted token', () => {
  for (const name of ['Grizzly Bears', 'Beast Token']) {
    let s = rich();
    put(s, 'Hazardroot Herbalist');
    const target = put(s, name),
      other = put(s, 'Hill Giant');
    s.step = 'attackers';
    s.choice = { kind: 'attackers', player: 0 };
    s = act(s, 'attackers', { cards: [target.id, other.id] });
    assert.equal(s.choice.kind, 'triggerTarget');
    s = act(s, 'chooseTriggerTarget', { target: ref(target) });
    assert.equal(s.stack.length, 1);
    s = resolve(s);
    assert.equal(stats(s, s.objects[target.id]).power, name === 'Beast Token' ? 4 : 3);
    assert.equal(hasKeyword(s, s.objects[target.id], 'deathtouch'), name === 'Beast Token');
  }
});
test('Sunpearl Kirin can omit its target, bounces another own nonland permanent, and draws for tokens only', () => {
  for (const name of [null, 'Basilisk Collar', 'Food Token']) {
    let s = rich();
    const target = name && put(s, name),
      result = cast(s, 'Sunpearl Kirin');
    s = result.state;
    assert.ok(hasKeyword(s, s.objects[result.id], 'flash'));
    assert.ok(hasKeyword(s, s.objects[result.id], 'flying'));
    const hand = s.players[0].hand.length;
    s = act(s, 'chooseTriggerTargets', { targets: { returned: target ? [ref(target)] : [] } });
    s = resolve(s);
    if (target)
      assert.equal(s.objects[target.id]?.zone, name === 'Food Token' ? undefined : 'hand');
    assert.equal(s.players[0].hand.length, hand + Number(name !== null));
  }
});
test('real target-bound branches retain exact state through deterministic command replay', () => {
  const names = [
    'Grizzly Bears',
    'Malamet Battle Glyph',
    'Throw from the Saddle',
    'Basilisk Collar',
    'Seedship Impact',
  ];
  const defs = names.map((name) => ({ ...CARDS[name], cost: {} }));
  const spawn = {
    name: 'Replay target maker',
    type: 'sorcery',
    cost: {},
    effects: [{ op: 'token', definition: 'Beast Token', count: 2, player: 'opponent' }],
  };
  let s = createGame({
    catalog: createRegistry([
      ...defs,
      spawn,
      CARDS.Forest,
      CARDS['Beast Token'],
      CARDS['Lander Token'],
    ]),
    minimumDeckSize: 7,
    mulligan: false,
    decks: [[...names, spawn.name, 'Forest'], Array(7).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  const check = () => assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  const bear = id('Grizzly Bears');
  s = resolve(act(s, 'cast', { card: bear }));
  s = resolve(act(s, 'cast', { card: id(spawn.name) }));
  const victims = tokens(s, 'Beast Token');
  // Throw gives 3/3 temporarily, then Malamet gives a counter before its fight.
  s = act(s, 'cast', {
    card: id('Throw from the Saddle'),
    targets: { actor: [ref(s.objects[bear])], victim: [ref(victims[0])] },
  });
  check();
  s = resolve(s);
  check();
  s = resolve(
    act(s, 'cast', {
      card: id('Malamet Battle Glyph'),
      targets: { actor: [ref(s.objects[bear])], victim: [ref(victims[1])] },
    }),
  );
  check();
  const artifact = id('Basilisk Collar');
  s = resolve(act(s, 'cast', { card: artifact }));
  s = resolve(act(s, 'cast', { card: id('Seedship Impact'), target: ref(s.objects[artifact]) }));
  check();
  assert.equal(tokens(s, 'Lander Token').length, 1);
});

test('policy previews receive the declared primary/group bindings without mutating state or exposing hidden identities', async () => {
  const { actionEffects, resolutionRisk } = await import('../src/decision-safety.js');
  const s = rich(),
    ooze = put(s, 'Scavenging Ooze'),
    creature = put(s, 'Grizzly Bears', 1, 'graveyard'),
    land = put(s, 'Forest', 1, 'graveyard');
  const before = structuredClone(s);
  const preview = (target) =>
    actionEffects(s, { type: 'activate', card: ooze.id, ability: 0, target: ref(target) });
  assert.deepEqual(
    preview(creature).map((e) => e.op),
    ['moveTarget', 'counterOn', 'gainLife'],
  );
  assert.deepEqual(
    preview(land).map((e) => e.op),
    ['moveTarget'],
  );
  assert.deepEqual(s, before);
  const actor = put(s, 'Grizzly Bears'),
    victim = put(s, 'Hill Giant', 1),
    spell = put(s, 'Throw from the Saddle', 0, 'hand');
  actor.definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: ['Mount'] };
  const effects = actionEffects(s, {
    type: 'cast',
    card: spell.id,
    targets: { actor: [ref(actor)], victim: [ref(victim)] },
  });
  assert.deepEqual(
    effects.map((e) => e.op),
    ['counterOn', 'bite'],
  );
  const conditionalDraw = [
    {
      op: 'conditional',
      condition: selfTarget({ type: 'creature' }),
      then: [{ op: 'draw', count: 1 }],
    },
  ];
  s.players[0].library = [];
  assert.equal(
    resolutionRisk(s, 0, conditionalDraw, ref(actor), 0, null, 0, { targetKind: 'creature' }),
    'library',
  );
});

test('a grouped controller dependency is snapshotted before movement and is absent for an illegal group', () => {
  for (const illegal of [false, true]) {
    let s = rich();
    const ownedByOpponent = put(s, 'Grizzly Bears', 1),
      other = put(s, 'Hill Giant');
    ownedByOpponent.controller = 0;
    const condition = { kind: 'targetMatches', targetGroup: 'chosen', where: { type: 'creature' } };
    const card = {
      name: 'Grouped controller snapshot fixture',
      type: 'instant',
      cost: {},
      targetGroups: [
        { id: 'chosen', selector: 'creature', min: 1, max: 1 },
        { id: 'other', selector: 'creature', min: 1, max: 1 },
      ],
      effects: [
        {
          op: 'conditional',
          condition,
          then: [
            { op: 'destroy', targetGroup: 'chosen' },
            { op: 'damageTargetController', targetGroup: 'chosen', amount: 2 },
          ],
        },
      ],
    };
    s.catalog = createRegistry({ ...s.catalog, [card.name]: card });
    const spell = put(s, card.name, 0, 'hand');
    s = act(s, 'cast', {
      card: spell.id,
      targets: { chosen: [ref(ownedByOpponent)], other: [ref(other)] },
    });
    if (illegal) modifier(s, s.objects[ownedByOpponent.id], { keywords: ['shroud'] });
    s = resolve(s);
    assert.equal(s.players[0].life, illegal ? 20 : 18);
    assert.equal(s.players[1].life, 20);
  }
});

test('a paused resolution preserves its checked target and resumes live predicates without a new targeting check', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears', 1);
  const name = customSpell(s, [
    { op: 'modify', power: 0, toughness: 0, keywords: ['hexproof'] },
    { op: 'scry', count: 1 },
    {
      op: 'conditional',
      condition: selfTarget({ power: { eq: 2 } }),
      then: [{ op: 'gainLife', amount: 2 }],
    },
  ]);
  s = cast(s, name, { target: ref(target) }).state;
  assert.equal(s.choice.action, 'scry');
  assert.equal(s.resolving.entry.targetsRechecked, true);
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.players[0].life, 22);
});

test('target-aware previews retain the independent Bargain paid state', async () => {
  const { actionEffects } = await import('../src/decision-safety.js');
  const s = rich(),
    target = put(s, 'Hill Giant', 1),
    spell = put(s, 'Candy Grapple', 0, 'hand');
  for (const mode of [0, 1]) {
    const effects = actionEffects(s, { type: 'cast', card: spell.id, mode, target: ref(target) });
    assert.equal(effects[0].power, mode ? -5 : -3);
    assert.equal(effects[0].toughness, mode ? -5 : -3);
  }
});

test('grouped bot preview binds Malamet’s actor before scoring its conditional counter and fight', () => {
  const s = rich(),
    actor = put(s, 'Grizzly Bears'),
    victim = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Malamet Battle Glyph', 0, 'hand');
  const before = structuredClone(s);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'cast');
  assert.equal(command.card, spell.id);
  assert.deepEqual(command.targets, { actor: [ref(actor)], victim: [ref(victim)] });
  assert.deepEqual(s, before);
  const result = dispatch(s, command);
  assert.equal(result.ok, true);
  const resolved = resolve(result.state);
  assert.equal(resolved.objects[actor.id].zone, 'battlefield');
  assert.equal(resolved.objects[victim.id].zone, 'graveyard');
});
