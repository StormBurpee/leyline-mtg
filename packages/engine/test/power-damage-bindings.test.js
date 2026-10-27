import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  createGame,
  dispatch,
  hasKeyword,
  stats,
  exportReplay,
  replay,
  chooseBotCommand,
} from '../src/index.js';
import { move, ref } from '../src/model.js';
import { fixture, put, act, resolve } from './helpers.js';
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, extra = {}) => {
  const card = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: card.id, ...extra })), id: card.id };
};
const modifier = (s, o, fields) =>
  s.modifiers.push({ objectId: o.id, incarnation: o.incarnation, expires: s.turn, ...fields });
const damage = (s, source) => s.events.filter((e) => e.type === 'damage' && e.source === source.id);

test('Bite Down and Hard-Hitting Question target opposing creatures or planeswalkers, never own victims or players', () => {
  for (const name of ['Bite Down', 'Hard-Hitting Question']) {
    let s = rich();
    const actor = put(s, 'Grizzly Bears'),
      other = put(s, 'Jace Token', 1),
      own = put(s, 'Jace Token');
    other.loyalty = 8;
    own.loyalty = 8;
    const card = put(s, name, 0, 'hand');
    for (const victim of [ref(own), { kind: 'player', id: 1 }]) {
      const before = structuredClone(s);
      assert.equal(
        dispatch(s, {
          type: 'cast',
          player: 0,
          card: card.id,
          targets: { actor: [ref(actor)], victim: [victim] },
        }).ok,
        false,
      );
      assert.deepEqual(s, before);
    }
    s = act(s, 'cast', { card: card.id, targets: { actor: [ref(actor)], victim: [ref(other)] } });
    s.objects[actor.id].plusCounters = 3;
    s = resolve(s);
    assert.equal(s.objects[other.id].loyalty, 3);
    assert.equal(s.objects[actor.id].damage, 0);
    assert.equal(damage(s, actor).at(-1).amount, 5);
  }
});
test('grouped bite does no damage when the actor is illegal, absent or a returned incarnation', () => {
  for (const failure of ['gone', 'returned', 'control']) {
    let s = rich();
    const a = put(s, 'Grizzly Bears'),
      v = put(s, 'Jace Token', 1);
    v.loyalty = 9;
    const card = put(s, 'Bite Down', 0, 'hand');
    s = act(s, 'cast', { card: card.id, targets: { actor: [ref(a)], victim: [ref(v)] } });
    if (failure === 'control') s.objects[a.id].controller = 1;
    else {
      move(s, s.objects[a.id], 'hand');
      if (failure === 'returned') move(s, s.objects[a.id], 'battlefield');
    }
    s = resolve(s);
    assert.equal(s.objects[v.id].loyalty, 9);
    assert.equal(damage(s, a).length, 0);
  }
});
test('bite rechecks hexproof, victim incarnation, loyalty death, lifelink and supported damage replacement', () => {
  for (const change of ['hexproof', 'returned', 'none']) {
    let s = rich();
    const a = put(s, 'Valley Flamecaller'),
      v = put(s, 'Jace Token', 1);
    v.loyalty = 4;
    const collar = put(s, 'Basilisk Collar');
    collar.attachedTo = ref(a);
    const card = put(s, 'Bite Down', 0, 'hand');
    s = act(s, 'cast', { card: card.id, targets: { actor: [ref(a)], victim: [ref(v)] } });
    if (change === 'hexproof') modifier(s, s.objects[v.id], { keywords: ['hexproof'] });
    if (change === 'returned') {
      move(s, s.objects[v.id], 'hand');
      move(s, s.objects[v.id], 'battlefield');
      s.objects[v.id].loyalty = 4;
    }
    s = resolve(s);
    assert.equal(s.objects[v.id]?.zone, change === 'none' ? undefined : 'battlefield');
    assert.equal(s.players[0].life, change === 'none' ? 24 : 20);
    if (change === 'none') assert.equal(damage(s, a).at(-1).amount, 4);
  }
});
test('Hivespine Wolverine preserves all three ETB modes and token restrictions', () => {
  for (const mode of [0, 1, 2]) {
    let s = rich();
    const bear = put(s, 'Grizzly Bears'),
      token = put(s, 'Beast Token', 1),
      artifact = put(s, 'Basilisk Collar', 1);
    let result = cast(s, 'Hivespine Wolverine');
    s = result.s;
    s = act(s, 'chooseTriggerMode', { mode });
    if (mode === 1) {
      assert.equal(
        dispatch(s, { type: 'chooseTriggerTargets', player: 0, targets: { victim: [ref(bear)] } })
          .ok,
        false,
      );
      s = act(s, 'chooseTriggerTargets', { targets: { victim: [ref(token)] } });
    } else s = act(s, 'chooseTriggerTarget', { target: ref(mode === 0 ? bear : artifact) });
    s = resolve(s);
    assert.equal(s.objects[bear.id].plusCounters, mode === 0 ? 1 : 0);
    assert.equal(s.objects[token.id]?.zone, mode === 1 ? undefined : 'battlefield');
    assert.equal(s.objects[artifact.id].zone, mode === 2 ? 'graveyard' : 'battlefield');
    if (mode === 1) {
      assert.equal(s.objects[result.id].damage, 3);
      assert.equal(damage(s, { id: result.id }).at(-1).amount, 5);
    }
  }
});
test('source-bound fight cannot use LKI, a returned source, a noncreature or an illegal victim', () => {
  for (const failure of [
    'sourceGone',
    'sourceReturned',
    'sourceNotCreature',
    'victimGone',
    'victimHexproof',
  ]) {
    let s = rich();
    const victim = put(s, 'Beast Token', 1);
    const result = cast(s, 'Hivespine Wolverine');
    s = result.s;
    s = act(s, 'chooseTriggerMode', { mode: 1 });
    s = act(s, 'chooseTriggerTargets', { targets: { victim: [ref(victim)] } });
    if (failure.startsWith('source')) {
      if (failure === 'sourceNotCreature') s.objects[result.id].definitionOverride = CARDS.Forest;
      else {
        move(s, s.objects[result.id], 'hand');
        if (failure === 'sourceReturned') move(s, s.objects[result.id], 'battlefield');
      }
    } else if (failure === 'victimGone') move(s, s.objects[victim.id], 'hand');
    else modifier(s, s.objects[victim.id], { keywords: ['hexproof'] });
    s = resolve(s);
    assert.equal(damage(s, { id: result.id }).length, 0);
    assert.equal(damage(s, victim).length, 0);
  }
});
test('source-bound fight is simultaneous, reads current power, and uses each combatant’s deathtouch/lifelink', () => {
  let s = rich();
  const victim = put(s, 'Beast Token', 1);
  const result = cast(s, 'Hivespine Wolverine');
  s = result.s;
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  s = act(s, 'chooseTriggerTargets', { targets: { victim: [ref(victim)] } });
  modifier(s, s.objects[result.id], { power: 2, toughness: 0, keywords: ['lifelink'] });
  modifier(s, s.objects[victim.id], { keywords: ['deathtouch', 'lifelink'] });
  s = resolve(s);
  assert.equal(s.objects[result.id].zone, 'graveyard');
  assert.equal(s.objects[victim.id], undefined);
  assert.equal(s.players[0].life, 27);
  assert.equal(s.players[1].life, 23);
});
test('Affectionate Indrik chooses a mandatory target before its resolution-time optional fight', () => {
  for (const accept of [false, true]) {
    let s = rich();
    const victim = put(s, 'Grizzly Bears', 1);
    const result = cast(s, 'Affectionate Indrik');
    s = result.s;
    assert.equal(s.choice.kind, 'triggerTargets');
    assert.equal(
      dispatch(s, { type: 'chooseTriggerTargets', player: 0, targets: { victim: [] } }).ok,
      false,
    );
    s = act(s, 'chooseTriggerTargets', { targets: { victim: [ref(victim)] } });
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    assert.equal(s.objects[victim.id].damage, 0);
    s = act(s, 'resolveOptional', { accept });
    assert.equal(s.objects[victim.id].zone, accept ? 'graveyard' : 'battlefield');
    assert.equal(s.objects[result.id].damage, accept ? 2 : 0);
  }
});
test('Mind Meanderer can decline a fight and gains vigilance only from a controlled Jace planeswalker', () => {
  let s = rich();
  const opponent = put(s, 'Jace Token', 1);
  opponent.loyalty = 4;
  const result = cast(s, 'Mind Meanderer');
  s = result.s;
  s = act(s, 'chooseTriggerTargets', { targets: { victim: [] } });
  s = resolve(s);
  assert.ok(hasKeyword(s, s.objects[result.id], 'flying'));
  assert.equal(hasKeyword(s, s.objects[result.id], 'vigilance'), false);
  const mine = put(s, 'Jace Token');
  mine.loyalty = 4;
  assert.equal(hasKeyword(s, s.objects[result.id], 'vigilance'), true);
  move(s, mine, 'graveyard');
  assert.equal(hasKeyword(s, s.objects[result.id], 'vigilance'), false);
});
test('Flourishing Grapple strips abilities before biting and still strips when its own actor is illegal', () => {
  for (const actorGone of [false, true]) {
    let s = rich();
    const a = put(s, 'Grizzly Bears'),
      v = put(s, 'Hill Giant', 1);
    modifier(s, v, { keywords: ['indestructible'] });
    const card = put(s, 'Flourishing Grapple', 0, 'hand');
    s = act(s, 'cast', { card: card.id, targets: { actor: [ref(a)], victim: [ref(v)] } });
    s.objects[a.id].plusCounters = 2;
    if (actorGone) move(s, s.objects[a.id], 'hand');
    s = resolve(s);
    assert.equal(s.objects[v.id].zone, actorGone ? 'battlefield' : 'graveyard');
    if (actorGone) assert.equal(hasKeyword(s, s.objects[v.id], 'indestructible'), false);
  }
});
test('Flourishing Grapple accepts red/white planeswalkers and rejects blue creatures', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears'),
    v = put(s, 'Jace Token', 1),
    blue = put(s, 'Merfolk Looter', 1);
  v.loyalty = 8;
  v.definitionOverride = { ...CARDS['Jace Token'], color: ['R'] };
  const card = put(s, 'Flourishing Grapple', 0, 'hand');
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: card.id,
      targets: { actor: [ref(a)], victim: [ref(blue)] },
    }).ok,
    false,
  );
  s = resolve(act(s, 'cast', { card: card.id, targets: { actor: [ref(a)], victim: [ref(v)] } }));
  assert.equal(s.objects[v.id].loyalty, 6);
  assert.equal(s.objects[v.id].zone, 'battlefield');
});
test('source-bound bite uses departure LKI stats and keywords, never a returned incarnation', () => {
  let s = rich();
  s.catalog = createRegistry({
    ...CARDS,
    'LKI biter': {
      name: 'LKI biter',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 3,
      activated: [
        {
          cost: {},
          targetGroups: [{ id: 'victim', selector: 'creature', min: 1, max: 1 }],
          effects: [{ op: 'bite', source: 'source', victimGroup: 'victim' }],
        },
      ],
    },
  });
  const a = put(s, 'LKI biter'),
    v = put(s, 'Colossal Dreadmaw', 1);
  const collar = put(s, 'Basilisk Collar');
  collar.attachedTo = ref(a);
  s = act(s, 'activate', { card: a.id, ability: 0, targets: { victim: [ref(v)] } });
  s.objects[a.id].plusCounters = 2;
  move(s, s.objects[a.id], 'graveyard');
  move(s, s.objects[a.id], 'battlefield');
  s.objects[a.id].plusCounters = 30;
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 24);
  assert.equal(damage(s, a).at(-1).amount, 4);
});
test('actual modal fight and bite instructions survive deterministic replay at each decision', () => {
  // Only mana costs are waived; the real card's modes, targets and effects are unchanged.
  const names = ['Hivespine Wolverine', 'Grizzly Bears', 'Bite Down'];
  const defs = names.map((name) => ({ ...CARDS[name], cost: {} }));
  const spawn = {
    name: 'Replay victim maker',
    type: 'sorcery',
    cost: {},
    effects: [{ op: 'token', definition: 'Beast Token', count: 2, player: 'opponent' }],
  };
  const deck = [...names, spawn.name, ...Array(3).fill('Forest')];
  let s = createGame({
    catalog: createRegistry([...defs, spawn, CARDS.Forest, CARDS['Beast Token']]),
    minimumDeckSize: 7,
    mulligan: false,
    decks: [deck, Array(7).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  const check = () => assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  s = resolve(act(s, 'cast', { card: id('Grizzly Bears') }));
  const bear = Object.values(s.objects).find((o) => o.name === 'Grizzly Bears');
  s = resolve(act(s, 'cast', { card: id(spawn.name) }));
  const victims = Object.values(s.objects).filter((o) => o.name === 'Beast Token');
  s = resolve(act(s, 'cast', { card: id('Hivespine Wolverine') }));
  check();
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  check();
  s = act(s, 'chooseTriggerTargets', { targets: { victim: [ref(victims[0])] } });
  check();
  s = resolve(s);
  check();
  assert.equal(s.objects[victims[0].id], undefined);
  s = act(s, 'cast', {
    card: id('Bite Down'),
    targets: { actor: [ref(bear)], victim: [ref(victims[1])] },
  });
  check();
  s = resolve(s);
  check();
  assert.equal(s.objects[victims[1].id].damage, 2);
});

test('Burrog Barrage counts only another own instant/sorcery and can pump with no victim', () => {
  for (const prior of ['none', 'instant', 'creature', 'opponent']) {
    let s = rich();
    const a = put(s, 'Grizzly Bears'),
      v = put(s, 'Hill Giant', 1);
    if (prior === 'instant') {
      const spell = put(s, 'Lightning Bolt', 0, 'hand');
      s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } });
      s = resolve(s);
    }
    if (prior === 'creature') s = cast(s, 'Llanowar Elves').s;
    if (prior === 'opponent')
      s.players[1].spellsCast = {
        turn: s.turn,
        profiles: [
          {
            definition: { type: 'instant', types: ['instant'], color: ['U'], subtypes: [] },
            count: 3,
          },
        ],
      };
    const card = put(s, 'Burrog Barrage', 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id, targets: { actor: [ref(a)], victim: [ref(v)] } }));
    assert.equal(stats(s, s.objects[a.id]).power, prior === 'instant' ? 3 : 2);
    assert.equal(s.objects[v.id].zone, prior === 'instant' ? 'graveyard' : 'battlefield');
  }
  let s = rich();
  const a = put(s, 'Grizzly Bears');
  for (let i = 0; i < 2; i++) {
    const card = put(s, 'Burrog Barrage', 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id, targets: { actor: [ref(a)], victim: [] } }));
  }
  assert.equal(stats(s, s.objects[a.id]).power, 3);
});

test('source-bound optional fight bot selects a profitable victim using source power', () => {
  let s = rich();
  const victim = put(s, 'Grizzly Bears', 1);
  s = cast(s, 'Mind Meanderer').s;
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'chooseTriggerTargets');
  assert.deepEqual(command.targets.victim, [ref(victim)]);
  s = act(s, command.type, command);
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});
