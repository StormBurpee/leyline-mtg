import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  createRegistry,
  dispatch,
  castProblem,
  castingProfile,
  legalActions,
  manaValue,
  ref,
  replay,
  chooseBotCommand,
  stats,
} from '../packages/engine/src/index.js';
import { move, notifyTriggers, playableZone } from '../packages/engine/src/model.js';
import { stabilize } from '../packages/engine/src/effects.js';
import { nextTurn } from '../packages/engine/src/turn.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createSession } from '../packages/simulation/session.js';
import { game } from '../apps/web/view.js';
import { cardDropPlan } from '../apps/web/drop-plan.js';
const names = [
  'Bygone Colossus',
  'Germinating Wurm',
  'Knight Luminary',
  'Mechanozoa',
  'Red Tiger Mechan',
  'Sinister Cryologist',
  'Starbreach Whale',
  'Nova Hellkite',
  'Eusocial Engineering',
  'Weftstalker Ardent',
  'Starfield Shepherd',
  'Starwinder',
];
function end(s) {
  s.step = 'main2';
  s.priority = s.active;
  return resolve(s);
}
function warp(name = 'Bygone Colossus') {
  let s = fixture();
  lands(s, 'Island', 10);
  lands(s, 'Mountain', 5);
  lands(s, 'Forest', 5);
  lands(s, 'Plains', 5);
  const o = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: o.id, mode: 1 });
  s = resolve(s);
  return [s, o.id];
}
test('all twelve whole Standard cards round-trip through declarative warp source', async () => {
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    const first = compileCard(source, {
      identities: {
        'leyline:token/human-soldier-token': 'Human Soldier Token',
        'leyline:token/robot-token': 'Robot Token',
      },
    });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const second = compileCard(
      sourceFromDefinition(first.definition, {
        id: source.id,
        idsByName: { 'Human Soldier Token': 'Human Soldier Token', 'Robot Token': 'Robot Token' },
      }),
      {
        identities: { 'Human Soldier Token': 'Human Soldier Token', 'Robot Token': 'Robot Token' },
      },
    );
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(second.definition, first.definition);
  }
});
test('warp is an alternative hand casting mode, preserves printed mana value and cast history', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const o = put(s, 'Bygone Colossus', 0, 'hand');
  assert.match(castProblem(s, 0, o.id, null, { mode: 0 }), /mana/);
  assert.equal(castProblem(s, 0, o.id, null, { mode: 1 }), null);
  assert.equal(manaValue(CARDS[o.name]), 9);
  assert.equal(cardDropPlan(s, 0, o.id).kind, 'chooseMode');
  s = act(s, 'cast', { card: o.id, mode: 1 });
  assert.equal(s.stack.at(-1).warpPaid, true);
  assert.equal(manaValue(s.stack.at(-1).sourceDefinition), 9);
  assert.equal(s.players[0].spellsCast.profiles[0].count, 1);
  assert.equal(s.events.findLast((e) => e.type === 'cast').warpPaid, true);
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'battlefield');
  assert.equal(s.delayedTriggers.length, 1);
  s = end(s);
  assert.equal(s.objects[o.id].zone, 'battlefield');
  assert.equal(s.stack.at(-1).rule, 'warpExile');
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'exile');
  assert.ok(s.objects[o.id].warped);
  assert.match(castProblem(s, 0, o.id), /after the turn/);
  nextTurn(s);
  nextTurn(s);
  s.step = 'main1';
  assert.equal(castingProfile(s, 0, s.objects[o.id], 1), null);
  assert.match(castProblem(s, 0, o.id), /mana/);
  lands(s, 'Island', 6);
  assert.equal(castProblem(s, 0, o.id), null);
  s = act(s, 'cast', { card: o.id });
  s = resolve(s);
  assert.equal(s.objects[o.id].warped, undefined);
  assert.equal(s.delayedTriggers, undefined);
  s = end(s);
  assert.equal(s.objects[o.id].zone, 'battlefield');
});
test('normal casting has no delayed exile and warp obeys timing', () => {
  let s = fixture();
  lands(s, 'Island', 9);
  const o = put(s, 'Bygone Colossus', 0, 'hand');
  s.step = 'end';
  assert.match(castProblem(s, 0, o.id, null, { mode: 1 }), /main phase/);
  s.step = 'main1';
  s = act(s, 'cast', { card: o.id, mode: 0 });
  s = resolve(s);
  s = end(s);
  assert.equal(s.objects[o.id].zone, 'battlefield');
  assert.equal(s.delayedTriggers, undefined);
});
test('countered warp goes to graveyard, not flashback exile; no delayed trigger is created', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  lands(s, 'Island', 2, 1);
  const o = put(s, 'Bygone Colossus', 0, 'hand'),
    counter = put(s, 'Essence Scatter', 1, 'hand');
  s = act(s, 'cast', { card: o.id, mode: 1 });
  const target = { kind: 'stack', id: s.stack.at(-1).id };
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target });
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'graveyard');
  assert.equal(s.objects[o.id].warpPaid, undefined);
  assert.equal(s.delayedTriggers, undefined);
});
test('delayed exile is incarnation-bound before triggering and while on stack', () => {
  for (const during of [false, true])
    for (const dest of ['hand', 'graveyard', 'exile']) {
      let [s, id] = warp();
      if (during) s = end(s);
      move(s, s.objects[id], dest);
      if (dest !== 'exile') move(s, s.objects[id], 'battlefield');
      if (!during) s = end(s);
      s = resolve(s);
      assert.equal(s.objects[id].zone, dest === 'exile' ? 'exile' : 'battlefield');
      assert.equal(s.objects[id].warped, undefined);
      if (dest === 'exile') assert.equal(playableZone(s, s.objects[id], 0), false);
    }
});
test('delayed controller remains caster, exile permission belongs to owner and expires on movement', () => {
  let [s, id] = warp();
  s.objects[id].controller = 1;
  s = end(s);
  assert.equal(s.stack.at(-1).controller, 0);
  s = resolve(s);
  nextTurn(s);
  assert.equal(playableZone(s, s.objects[id], 1), false);
  assert.equal(playableZone(s, s.objects[id], 0), true);
  nextTurn(s);
  nextTurn(s);
  nextTurn(s);
  assert.ok(s.objects[id].warped);
  move(s, s.objects[id], 'hand');
  move(s, s.objects[id], 'exile');
  assert.equal(playableZone(s, s.objects[id], 0), false);
});
test('warping during an end step waits until the next end step; flash recast waits past that exile turn', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Bygone Colossus': { ...CARDS['Bygone Colossus'], keywords: ['flash'] },
  });
  lands(s, 'Island', 12);
  const o = put(s, 'Bygone Colossus', 0, 'hand');
  s.step = 'end';
  s = act(s, 'cast', { card: o.id, mode: 1 });
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  assert.equal(s.delayedTriggers.length, 1);
  nextTurn(s);
  s = end(s);
  s = resolve(s);
  assert.equal(s.objects[o.id].warped.turn, s.turn);
  s.priority = 0;
  assert.match(castProblem(s, 0, o.id), /after the turn/);
  nextTurn(s);
  s.priority = 0;
  assert.equal(castProblem(s, 0, o.id), null);
});
test('ETB effects resolve independently from warp: life, tokens, damage, debuff, stun and surveil', () => {
  let [s, id] = warp('Germinating Wurm');
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  [s, id] = warp('Knight Luminary');
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'Human Soldier Token');
  assert.ok(token);
  assert.deepEqual(CARDS[token.name].subtypes, ['Human', 'Soldier']);
  for (const name of ['Mechanozoa', 'Sinister Cryologist', 'Nova Hellkite']) {
    let base = fixture();
    lands(base, 'Island', 10);
    lands(base, 'Mountain', 10);
    const target = put(base, 'Grizzly Bears', 1);
    const card = put(base, name, 0, 'hand');
    base = act(base, 'cast', { card: card.id, mode: 1 });
    base = resolve(base);
    const action = legalActions(base, base.choice.player).find((a) => a.target?.id === target.id);
    assert.ok(action);
    base = act(base, action.type, action);
    base = resolve(base);
    if (name === 'Mechanozoa') {
      assert.equal(base.objects[target.id].tapped, true);
      assert.equal(base.objects[target.id].stunCounters, 1);
    }
    if (name === 'Sinister Cryologist')
      assert.equal(stats(base, base.objects[target.id]).power, -1);
    if (name === 'Nova Hellkite') assert.equal(base.objects[target.id].damage, 1);
  }
  [s, id] = warp('Starbreach Whale');
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 2);
});
test('bot can choose affordable warp and opaque session replay retains delayed incarnation state', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const o = put(s, 'Bygone Colossus', 0, 'hand');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.card, o.id);
  assert.equal(command.mode, 1);
  assert.equal(dispatch(s, command).ok, true);
  let session;
  for (let seed = 1; seed < 100; seed++) {
    session = createSession({
      seed,
      mulligan: false,
      catalog: { ...CARDS, 'Bygone Colossus': { ...CARDS['Bygone Colossus'], warp: {} } },
      decks: [
        [...Array(4).fill('Bygone Colossus'), ...Array(56).fill('Island')],
        Array(60).fill('Forest'),
      ],
    });
    if (
      Object.values(session.context().observation.objects).some((o) => o.name === 'Bygone Colossus')
    )
      break;
  }
  let c = session.context();
  while (c.observation.step !== 'main1') {
    assert.equal(session.step({ type: 'pass', player: c.player }).ok, true);
    c = session.context();
  }
  const action = c.actions.find((a) => a.type === 'cast' && a.mode === 1);
  assert.ok(action);
  assert.match(action.card, /^object:/);
  assert.equal(session.step(action).ok, true);
  for (let i = 0; i < 2; i++) {
    c = session.context();
    assert.equal(session.step({ type: 'pass', player: c.player }).ok, true);
  }
  c = session.context();
  assert.equal(c.observation.delayedTriggers.length, 1);
  assert.match(c.observation.delayedTriggers[0].source.id, /^object:/);
  const replayed = replay(session.exportReplay());
  assert.equal(replayed.delayedTriggers.length, 1);
  assert.equal(replayed.revision, c.revision);
});
test('warp cost is modified after substitution while normal cost remains separately available', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Bygone Colossus': {
      ...CARDS['Bygone Colossus'],
      costModifiers: [{ scope: 'self', change: 'reduce', amount: 2 }],
    },
    'Grizzly Bears': {
      ...CARDS['Grizzly Bears'],
      costModifiers: [{ scope: 'opponent', change: 'increase', amount: 4 }],
    },
  });
  const o = put(s, 'Bygone Colossus', 0, 'hand');
  put(s, 'Grizzly Bears', 1);
  lands(s, 'Island', 5);
  assert.equal(castingProfile(s, 0, o, 1).cost.generic, 5);
  assert.equal(castingProfile(s, 0, o, 0).cost.generic, 11);
  assert.equal(castProblem(s, 0, o.id, null, { mode: 1 }), null);
  assert.match(castProblem(s, 0, o.id, null, { mode: 0 }), /mana/);
});
test('the additional whole cards execute artifact tokens and nonduplicated enter damage', () => {
  let [s, id] = warp('Eusocial Engineering');
  put(s, 'Forest', 0, 'hand');
  const land = s.players[0].hand.find((i) => s.objects[i].name === 'Forest');
  s = act(s, 'playLand', { card: land });
  s = resolve(s);
  const robot = Object.values(s.objects).find((o) => o.name === 'Robot Token');
  assert.ok(robot);
  assert.deepEqual(CARDS[robot.name].types, ['artifact', 'creature']);
  [s, id] = warp('Weftstalker Ardent');
  assert.equal(s.stack.length, 0);
  const card = put(s, 'Red Tiger Mechan', 0, 'hand');
  s = act(s, 'cast', { card: card.id, mode: 1 });
  s = resolve(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
});
test('warp refuses unsupported alternative combinations and variable warp costs', () => {
  for (const extra of [
    { warp: { X: 1 } },
    { modes: [{ label: 'A', effects: [] }] },
    { plot: { generic: 1 } },
    { kicker: { cost: { generic: 1 }, effects: [] } },
  ])
    assert.throws(() =>
      createRegistry({ ...CARDS, 'Bygone Colossus': { ...CARDS['Bygone Colossus'], ...extra } }),
    );
});
test('UI labels warped exile, blocks same-turn recast and keeps normal versus warp choices explicit', () => {
  let [s, id] = warp();
  s = end(s);
  s = resolve(s);
  const ui = {
    mode: 'bot',
    chosen: [],
    blocks: [],
    activation: null,
    spellMode: null,
    controlMode: 'smart',
    stops: {},
    view: 'play',
    sideTab: 'stack',
    selected: id,
  };
  assert.match(game(s, ui, {}), /Warped · exile/);
  assert.match(game(s, ui, {}), /normal cost/);
  assert.match(game(s, ui, {}), /data-action="playSelected" disabled/);
  nextTurn(s);
  nextTurn(s);
  s.step = 'main1';
  assert.doesNotMatch(game(s, ui, {}), /data-action="playSelected" disabled/);
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.card === id && a.type === 'cast')
      .map((a) => a.mode),
    [0],
  );
});
test('Starfield Shepherd offers precisely basic Plains or cheap creature search, and Starwinder uses event damage amount', () => {
  let [s, id] = warp('Starfield Shepherd');
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(
    s.choice.cards.every((i) => {
      const d = CARDS[s.objects[i].name];
      return (
        (d.basic && d.subtypes.includes('Plains')) || (d.type === 'creature' && manaValue(d) <= 1)
      );
    }),
  );
  [s, id] = warp('Starwinder');
  const attacker = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'combatDamagePlayer', { object: attacker, player: 0, amount: 4 });
  stabilize(s);
  assert.equal(s.stack.at(-1).eventAmount, 4);
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  s = act(s, 'resolveOptional', { accept: true });
  assert.equal(s.players[0].hand.length, before + 4);
});
test('warp delayed abilities join simultaneous end-step APNAP ordering rather than exiling as a turn action', () => {
  let [s, id] = warp();
  s.catalog = createRegistry({
    ...CARDS,
    'Grizzly Bears': {
      ...CARDS['Grizzly Bears'],
      triggers: [
        { event: { event: 'step', step: 'end' }, effects: [{ op: 'gainLife', amount: 1 }] },
      ],
    },
  });
  put(s, 'Grizzly Bears', 0);
  put(s, 'Grizzly Bears', 1);
  s = end(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.player, 0);
  assert.ok(s.choice.entries.some((e) => e.rule === 'warpExile'));
  assert.equal(s.objects[id].zone, 'battlefield');
  const order = s.choice.entries.map((e) => e.id);
  s = act(s, 'orderTriggers', { ids: order });
  assert.equal(s.stack.at(-1).controller, 1);
  assert.equal(s.stack.length, 3);
});
