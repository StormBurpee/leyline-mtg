import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  legalActions,
  castingProfile,
  castingPayment,
  castingSacrificeCandidates,
  ref,
  stats,
  keywords,
  chooseBotCommand,
} from '../src/index.js';
import { actionEffects } from '../src/decision-safety.js';
import { move, addObject } from '../src/model.js';
import { enterBattlefield } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const mana = (s) => {
  for (const c of ['W', 'U', 'B', 'R', 'G']) s.players[0].mana[c] = 30;
};
function cast(s, name, { bargain = true, target, x } = {}) {
  const spell = put(s, name, 0, 'hand');
  mana(s);
  const payment = bargain ? put(s, 'Treasure Token') : null;
  return [
    act(s, 'cast', {
      card: spell.id,
      mode: bargain ? 1 : 0,
      ...(payment ? { sacrifice: ref(payment) } : {}),
      ...(target ? { target } : {}),
      ...(x !== undefined ? { x } : {}),
    }),
    spell,
  ];
}
test('bargain is explicitly optional, requires one exact eligible controlled permanent, and rejects atomically', () => {
  const s = fixture();
  mana(s);
  const spell = put(s, 'Candy Grapple', 0, 'hand'),
    bear = put(s, 'Grizzly Bears', 1),
    plain = put(s, 'Grizzly Bears'),
    food = put(s, 'Food Token'),
    enchantment = put(s, 'Glorious Anthem'),
    land = put(s, 'Forest');
  const profile = castingProfile(s, 0, spell, 1, ref(bear));
  assert.equal(CARDS['Candy Grapple'].modes, undefined);
  assert.equal(profile.bargained, true);
  assert.deepEqual(
    new Set(castingSacrificeCandidates(s, 0, profile).map((o) => o.id)),
    new Set([food.id, enchantment.id]),
  );
  for (const sacrifice of [
    undefined,
    null,
    ref(plain),
    ref(bear),
    ref(land),
    { ...ref(food), incarnation: 900 },
    { ...ref(food), extra: true },
  ]) {
    const before = structuredClone(s),
      r = dispatch(s, {
        type: 'cast',
        player: 0,
        card: spell.id,
        mode: 1,
        target: ref(bear),
        sacrifice,
      });
    assert.equal(r.ok, false);
    assert.deepEqual(s, before);
  }
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      mode: 0,
      target: ref(bear),
      sacrifice: ref(food),
    }).ok,
    false,
  );
  const noBargain = dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(bear) });
  assert.equal(noBargain.ok, true);
  assert.equal(noBargain.state.stack.at(-1).bargained, undefined);
  assert.ok(noBargain.state.objects[food.id]);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 0 && !a.sacrifice));
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1 && a.sacrifice));
});
test('any token qualifies, including a token land; nontoken artifacts qualify but ordinary creatures do not', () => {
  const s = fixture();
  mana(s);
  const spell = put(s, 'Hamlet Glutton', 0, 'hand'),
    token = addObject(s, 'Forest', 0, 'exile', { ...CARDS['Forest'], token: true }),
    artifact = put(s, 'Candy Trail'),
    plain = put(s, 'Grizzly Bears');
  enterBattlefield(s, token, 0);
  const candidates = castingSacrificeCandidates(s, 0, castingProfile(s, 0, spell, 1)).map(
    (o) => o.id,
  );
  assert.ok(candidates.includes(token.id));
  assert.ok(candidates.includes(artifact.id));
  assert.ok(!candidates.includes(plain.id));
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, mode: 1, sacrifice: ref(token) }).ok,
    true,
  );
});
test('sacrificing a mana source reserves it, allows tapping an eligible mana source, and locks reductions before payment', () => {
  let s = fixture();
  const spell = put(s, 'Ice Out', 0, 'hand'),
    target = put(s, 'Shock', 1, 'hand'),
    treasure = put(s, 'Treasure Token');
  s.priority = 1;
  s.players[1].mana.R = 1;
  s = act(s, 'cast', { card: target.id, target: { kind: 'player', id: 0 } }, 1);
  s = act(s, 'pass', {}, 1);
  const stack = { kind: 'stack', id: s.stack[0].id };
  lands(s, 'Island', 1);
  const profile = castingProfile(s, 0, s.objects[spell.id], 1, stack);
  assert.deepEqual(profile.cost, { generic: 0, U: 2 });
  assert.equal(
    castingPayment(s, 0, profile, { card: spell.id, sacrifice: ref(s.objects[treasure.id]) }),
    null,
  );
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      mode: 1,
      target: stack,
      sacrifice: ref(s.objects[treasure.id]),
    }).ok,
    false,
  );
  assert.deepEqual(s, before);
  lands(s, 'Island', 1);
  s = act(s, 'cast', {
    card: spell.id,
    mode: 1,
    target: stack,
    sacrifice: ref(s.objects[treasure.id]),
  });
  assert.deepEqual(s.stack.at(-1).castingCost, { generic: 0, U: 2 });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Mana charm': { name: 'Mana charm', type: 'artifact', cost: {}, mana: ['W'] },
  });
  const glory = put(s, "Archon's Glory", 0, 'hand'),
    charm = put(s, 'Mana charm'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: glory.id, mode: 1, target: ref(bear), sacrifice: ref(charm) });
  assert.equal(s.objects[charm.id].zone, 'graveyard');
  assert.ok(
    s.events.some((e) => e.type === 'mana' && e.objectId === charm.id) ||
      s.events.some((e) => e.type === 'tapped' && e.objectId === charm.id),
  );
});
test('targets are announced before bargain payment and sacrificed targets fizzle without recovering the cost', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Offering: {
      name: 'Offering',
      type: 'creature',
      types: ['artifact', 'creature'],
      power: 2,
      toughness: 2,
      cost: {},
      triggers: [
        {
          event: { event: 'targeted', object: 'source' },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
        { event: 'selfDies', effects: [{ op: 'gainLife', amount: 2 }] },
      ],
    },
  });
  const offering = put(s, 'Offering', 1);
  offering.controller = 0;
  const spell = put(s, "Archon's Glory", 0, 'hand');
  mana(s);
  const old = ref(offering);
  s = act(s, 'cast', { card: spell.id, mode: 1, target: old, sacrifice: old });
  assert.equal(s.objects[offering.id].zone, 'graveyard');
  assert.equal(s.choice.kind, 'orderTriggers');
  const pending = s.choice.entries;
  assert.equal(pending.length, 2);
  assert.ok(pending.every((e) => e.controller === 0 && e.source.incarnation === old.incarnation));
  const targeted = s.events.findIndex((e) => e.type === 'triggered' && e.name === 'Offering'),
    sacrificed = s.events.findIndex((e) => e.type === 'sacrificed' && e.objectId === offering.id);
  assert.ok(targeted < sacrificed);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  s = resolve(s);
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});
test('Archon, Candy and Stonesplitter have distinct bargained effects and bot previews', () => {
  for (const bargain of [false, true]) {
    let s = fixture();
    const bear = put(s, 'Grizzly Bears');
    [s] = cast(s, "Archon's Glory", { bargain, target: ref(bear) });
    s = resolve(s);
    assert.equal(stats(s, s.objects[bear.id]).power, 4);
    assert.equal(keywords(s, s.objects[bear.id]).includes('lifelink'), bargain);
    s = fixture();
    const giant = put(s, 'Serra Angel', 1);
    [s] = cast(s, 'Candy Grapple', { bargain, target: ref(giant) });
    s = resolve(s);
    assert.equal(s.objects[giant.id].zone, bargain ? 'graveyard' : 'battlefield');
    s = fixture();
    const victim = put(s, 'Serra Angel', 1),
      bolt = put(s, 'Stonesplitter Bolt', 0, 'hand'),
      food = put(s, 'Food Token');
    mana(s);
    const action = {
      type: 'cast',
      card: bolt.id,
      mode: bargain ? 1 : 0,
      target: ref(victim),
      x: 2,
      ...(bargain ? { sacrifice: ref(food) } : {}),
    };
    assert.equal(actionEffects(s, action)[0].amount, bargain ? 4 : 2);
    s = act(s, 'cast', action);
    s = resolve(s);
    assert.equal(s.objects[victim.id].zone, bargain ? 'graveyard' : 'battlefield');
  }
});
test('Farsight looks at four/eight and requires two choices with seeded random bottom ordering', () => {
  for (const bargain of [false, true]) {
    let s = fixture();
    [s] = cast(s, 'Farsight Ritual', { bargain });
    s = resolve(s);
    assert.equal(s.choice.kind, 'libraryOrder');
    assert.equal(s.choice.cards.length, bargain ? 8 : 4);
    assert.equal(s.choice.selectCount, 2);
    assert.equal(s.choice.restOrder, 'random');
    const chosen = s.choice.cards.slice(0, 2),
      rest = s.choice.cards.slice(2);
    s = act(s, 'orderLibrary', { top: chosen, rest });
    assert.ok(chosen.every((id) => s.players[0].hand.includes(id)));
  }
});
test('Hamlet always gains life, High Fae only triggers when bargained, and blink/copies do not inherit bargain', () => {
  for (const bargain of [false, true]) {
    let s = fixture(),
      spell;
    [s, spell] = cast(s, 'Hamlet Glutton', { bargain });
    if (bargain) assert.deepEqual(s.stack[0].castingCost, { generic: 3, G: 2 });
    s = resolve(s);
    s = resolve(s);
    assert.equal(s.players[0].life, 23);
    assert.ok(keywords(s, s.objects[spell.id]).includes('trample'));
    s = fixture();
    [s, spell] = cast(s, 'High Fae Negotiator', { bargain });
    s = resolve(s);
    assert.equal(s.stack.length, bargain ? 1 : 0);
    if (!bargain) continue;
    const original = s.objects[spell.id];
    move(s, original, 'exile');
    enterBattlefield(s, original, 0);
    assert.equal(original.bargained, undefined);
    s = resolve(s);
    assert.equal(s.players[0].life, 23);
    assert.equal(s.players[1].life, 17);
    const token = addObject(s, 'High Fae Negotiator', 0, 'exile', {
      ...CARDS['High Fae Negotiator'],
      token: true,
    });
    enterBattlefield(s, token, 0);
    assert.equal(token.bargained, undefined);
    assert.equal(s.pendingTriggers.length, 0);
  }
});
test('Agatha may fight no creature, cannot fight after departing, and deals simultaneous actual-power damage', () => {
  for (const choice of ['none', 'fight', 'depart']) {
    let s = fixture();
    const enemy = put(s, 'Grizzly Bears', 1);
    let spell;
    [s, spell] = cast(s, "Agatha's Champion");
    s = resolve(s);
    assert.equal(s.choice.kind, 'triggerTargets');
    s = act(s, 'chooseTriggerTargets', {
      targets: { victim: choice === 'none' ? [] : [ref(s.objects[enemy.id])] },
    });
    if (choice === 'depart') move(s, s.objects[spell.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[enemy.id].zone, choice === 'fight' ? 'graveyard' : 'battlefield');
    if (choice === 'fight') assert.equal(s.objects[spell.id].damage, 2);
  }
});
test('Tomeseeker and Ouphe only announce eligible targets when bargained, and their abilities survive source departure', () => {
  for (const name of ['Tenacious Tomeseeker', 'Troublemaker Ouphe']) {
    let s = fixture();
    const target =
      name === 'Tenacious Tomeseeker'
        ? put(s, 'Shock', 0, 'graveyard')
        : put(s, 'Glorious Anthem', 1);
    const wrong =
      name === 'Tenacious Tomeseeker'
        ? put(s, 'Grizzly Bears', 0, 'graveyard')
        : put(s, 'Glorious Anthem');
    let spell;
    [s, spell] = cast(s, name);
    s = resolve(s);
    assert.equal(s.choice.kind, 'triggerTarget');
    assert.ok(s.choice.targets.some((t) => t.id === target.id));
    assert.ok(!s.choice.targets.some((t) => t.id === wrong.id));
    s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[target.id]) });
    move(s, s.objects[spell.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, name === 'Tenacious Tomeseeker' ? 'hand' : 'exile');
  }
});
test('Johann has the bargain discount and draw; Kellan destroys only an attacking or blocking target', () => {
  let s = fixture(),
    target = put(s, 'Glorious Anthem', 1),
    spell;
  [s, spell] = cast(s, "Johann's Stopgap", { target: ref(target) });
  assert.deepEqual(s.stack[0].castingCost, { generic: 1, U: 1 });
  const hand = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'hand');
  assert.equal(s.players[0].hand.length, hand + 1);
  for (const bargain of [false, true]) {
    s = fixture();
    target = put(s, 'Serra Angel', 1);
    s.combat.attackers = [ref(target)];
    [s] = cast(s, "Kellan's Lightblades", { bargain, target: ref(target) });
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, bargain ? 'graveyard' : 'battlefield');
  }
});
test('Hellkite adds any four independently chosen colors, keeps flying/haste and activated damage', () => {
  let s = fixture(),
    spell;
  [s, spell] = cast(s, 'Realm-Scorcher Hellkite');
  s = resolve(s);
  s = resolve(s);
  const before = { ...s.players[0].mana };
  for (const color of ['W', 'U', 'U', 'G']) {
    assert.equal(s.choice.kind, 'manaColor');
    s = act(s, 'chooseManaColor', { color });
  }
  assert.equal(s.players[0].mana.U, before.U + 2);
  assert.equal(s.players[0].mana.W, before.W + 1);
  assert.equal(s.players[0].mana.G, before.G + 1);
  assert.ok(keywords(s, s.objects[spell.id]).includes('haste'));
  s = act(s, 'activate', { card: spell.id, ability: 0, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
});
test('bot can bargain when it is the only way to cast a useful spell', () => {
  let s = fixture();
  const spell = put(s, 'Hamlet Glutton', 0, 'hand');
  put(s, 'Food Token');
  lands(s, 'Forest', 5);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.card, spell.id);
  assert.equal(command.mode, 1);
  assert.ok(command.sacrifice);
  assert.equal(dispatch(s, command).ok, true);
});
test('competing or malformed bargain profiles fail closed', () => {
  for (const extra of [
    { bargain: false },
    { bargain: true, kicker: { cost: {}, effects: [] } },
    { bargain: true, sacrificeCost: { where: { type: 'creature' } } },
    {
      bargain: true,
      cost: { X: 1 },
      distributedCounters: { scope: 'permanent', where: { type: 'creature' } },
      effects: [{ op: 'distributedCounters' }],
    },
    {
      bargain: true,
      modes: [
        { label: 'A', effects: [] },
        { label: 'B', effects: [] },
      ],
    },
  ])
    assert.throws(() =>
      createRegistry({ Bad: { name: 'Bad', type: 'instant', cost: {}, effects: [], ...extra } }),
    );
});

test('copying an actually bargained permanent copies its definition, not paid additional-cost status', () => {
  let s = fixture(),
    spell;
  [s, spell] = cast(s, 'High Fae Negotiator');
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.objects[spell.id].bargained, true);
  const copySpell = put(s, 'Rite of Replication', 0, 'hand');
  s = act(s, 'cast', { card: copySpell.id, mode: 0, target: ref(s.objects[spell.id]) });
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'High Fae Negotiator' && o.token);
  assert.ok(token);
  assert.equal(token.bargained, undefined);
  assert.equal(s.stack.length, 0);
  assert.equal(s.players[0].life, 23);
  assert.equal(s.players[1].life, 17);
});

test('countering a bargained spell does not refund its sacrifice, and empty ETB target sets do not prevent bargaining', () => {
  let s = fixture(),
    spell;
  [s, spell] = cast(s, 'High Fae Negotiator');
  s.players[1].mana.U = 5;
  const cancel = put(s, 'Cancel', 1, 'hand');
  const sacrifice = s.stack.at(-1).sacrifice.id;
  s = act(s, 'pass');
  s = act(s, 'cast', { card: cancel.id, target: { kind: 'stack', id: s.stack[0].id } });
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
  assert.equal(s.objects[sacrifice], undefined);
  assert.equal(s.objects[spell.id].bargained, undefined);
  s = fixture();
  [s, spell] = cast(s, 'Troublemaker Ouphe');
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'battlefield');
  assert.equal(s.stack.length, 0);
  assert.equal(s.choice, null);
});
