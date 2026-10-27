import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../packages/simulation/session.js';
import { replay } from '../packages/engine/src/index.js';

test('agent contexts omit seeds, deck orders, concealed handles and privileged records', () => {
  const session = createSession({ seed: 731 });
  const c = session.context(),
    o = c.observation;
  for (const key of ['seed', 'rng', 'config', 'history', 'events', 'nextId', 'pendingTriggers'])
    assert.equal(Object.hasOwn(o, key), false, key);
  assert.equal(o.players[0].library, undefined);
  assert.equal(o.players[1].hand, undefined);
  assert.equal(o.players[1].handCount, 7);
  assert.equal(o.players[0].libraryCount, 53);
  assert.equal(Object.keys(o.objects).length, 7);
  assert.ok(o.players[0].hand.every((id) => id.startsWith('object:')));
  assert.equal(Object.isFrozen(c), true);
  assert.throws(() => {
    o.players[0].life = 99;
  }, TypeError);
});
test('opaque handles are independent of original deck object numbers', () => {
  const a = createSession({ seed: 1 }).context(),
    b = createSession({ seed: 2 }).context();
  assert.deepEqual(a.observation.players[0].hand, b.observation.players[0].hand);
});
test('raw engine IDs and another player commands cannot cross the agent boundary', () => {
  const session = createSession();
  session.context();
  const before = session.exportReplay();
  assert.equal(session.step({ type: 'keep', player: 1 }).ok, false);
  assert.equal(session.step({ type: 'cast', player: 0, card: 'c1' }).error.code, 'AGENT_HANDLE');
  assert.deepEqual(session.exportReplay(), before);
});
test('session commands round-trip through privileged deterministic replay', () => {
  const session = createSession();
  for (let i = 0; i < 8; i++) {
    const c = session.context();
    const command =
      c.observation.choice?.kind === 'mulligan'
        ? { type: 'keep', player: c.player }
        : { type: 'pass', player: c.player };
    assert.equal(session.step(command).ok, true);
  }
  const s = replay(session.exportReplay());
  assert.equal(s.revision, session.context().revision);
  assert.equal(s.turn, session.summary().turn);
});
test('stale revisions are rejected without advancing the episode', () => {
  const session = createSession();
  const c = session.context();
  assert.equal(session.step({ type: 'keep', player: c.player, expectedRevision: 99 }).ok, false);
  assert.equal(session.context().revision, c.revision);
});

test('headless heuristic policies complete real games through the private boundary', async () => {
  const { runEpisode } = await import('../packages/simulation/run.js');
  for (const seed of [1, 731, 9876]) {
    const r = await runEpisode({ config: { seed }, includeReplay: true });
    assert.equal(r.termination, 'finished', JSON.stringify(r.error));
    assert.equal(r.status, 'finished');
    assert.equal(replay(r.replay).winner, r.winner);
  }
});
test('same seed and deterministic policies reproduce an identical episode', async () => {
  const { runEpisode } = await import('../packages/simulation/run.js');
  const options = { config: { seed: 17 }, includeReplay: true };
  assert.deepEqual(await runEpisode(options), await runEpisode(options));
});
test('simulation limits, policy failures and aborts are not counted as draws or wins', async () => {
  const { runEpisode } = await import('../packages/simulation/run.js');
  assert.equal((await runEpisode({ maxDecisions: 1 })).termination, 'decision_limit');
  const fail = () => {
    throw new Error('model unavailable');
  };
  assert.equal((await runEpisode({ policies: [fail, fail] })).termination, 'policy_error');
  const invalid = () => ({ type: 'cast', player: 0, card: 'c1' });
  assert.equal((await runEpisode({ policies: [invalid, invalid] })).termination, 'illegal_command');
  const controller = new AbortController();
  controller.abort();
  const r = await runEpisode({ signal: controller.signal });
  assert.equal(r.termination, 'aborted');
  assert.equal(r.winner, null);
});

test('changing only concealed opponent cards does not change an observation', () => {
  const own = Array(60).fill('Island');
  const first = createSession({ decks: [own, Array(60).fill('Forest')], seed: 7 }).context();
  const second = createSession({ decks: [own, Array(60).fill('Mountain')], seed: 7 }).context();
  assert.deepEqual(first, second);
});
test('library choice observations contain only the cards currently inspected', () => {
  const session = createSession({
    decks: [[...Array(56).fill('Island'), ...Array(4).fill('Opt')], Array(60).fill('Forest')],
    seed: 3,
  });
  function send(command) {
    const result = session.step(command);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  for (let i = 0; i < 20; i++) {
    const c = session.context();
    if (c.observation.step === 'main1' && !c.observation.choice) break;
    send({ type: c.observation.choice?.kind === 'mulligan' ? 'keep' : 'pass', player: c.player });
  }
  let c = session.context();
  send(c.actions.find((a) => a.type === 'playLand'));
  c = session.context();
  const opt = c.actions.find(
    (a) => a.type === 'cast' && c.observation.objects[a.card].name === 'Opt',
  );
  assert.ok(opt);
  send(opt);
  for (let i = 0; i < 2; i++) {
    c = session.context();
    send({ type: 'pass', player: c.player });
  }
  c = session.context();
  assert.equal(c.observation.choice.kind, 'libraryOrder');
  assert.equal(c.observation.choice.cards.length, 1);
  const libraryObjects = Object.values(c.observation.objects).filter((o) => o.zone === 'library');
  assert.equal(libraryObjects.length, 1);
  assert.equal(c.observation.players[0].library, undefined);
  send({ type: 'orderLibrary', player: c.player, top: [], rest: c.observation.choice.cards });
  assert.equal(session.context().observation.choice, null);
});

test('an agent receives only relevant public card definitions, not the full global catalog', () => {
  const session = createSession({ decks: [Array(60).fill('Island'), Array(60).fill('Forest')] });
  assert.deepEqual(Object.keys(session.context().observation.catalog), ['Island']);
});

test('episode outputs identify the engine, exact ruleset and experiment configuration', async () => {
  const { runEpisode } = await import('../packages/simulation/run.js');
  const first = await runEpisode({ config: { seed: 1 }, maxDecisions: 1 }),
    second = await runEpisode({ config: { seed: 2 }, maxDecisions: 1 });
  assert.match(first.rulesetHash, /^[a-f0-9]{64}$/);
  assert.match(first.configHash, /^[a-f0-9]{64}$/);
  assert.equal(first.rulesetHash, second.rulesetHash);
  assert.notEqual(first.configHash, second.configHash);
  assert.equal(first.engineVersion, '0.50.0');
});

test('target-choice actions use opaque handles and hide trigger-placement continuations', async () => {
  const { chooseBotCommand } = await import('../packages/engine/src/index.js');
  const session = createSession({
    decks: [
      [...Array(56).fill('Island'), ...Array(4).fill("Man-o'-War")],
      Array(60).fill('Forest'),
    ],
    seed: 3,
    mulligan: false,
  });
  let found = false;
  for (let i = 0; i < 400; i++) {
    const context = session.context();
    if (!context) break;
    if (context.observation.choice?.kind === 'triggerTarget') {
      found = true;
      assert.equal(context.observation.choice.remaining, undefined);
      assert.equal(context.observation.choice.remainingEntries, undefined);
      const actions = context.actions.filter((a) => a.type === 'chooseTriggerTarget');
      assert.ok(actions.length);
      for (const action of actions) {
        assert.match(action.target.id, /^object:/);
        assert.ok(context.observation.objects[action.target.id]);
      }
      assert.equal(session.step(actions[0]).ok, true);
      break;
    }
    const command = chooseBotCommand(context.observation, context.player);
    assert.equal(session.step(command).ok, true);
  }
  assert.equal(found, true);
});

test('a departed trigger source never exposes its concealed raw object ID', async () => {
  const { CARDS, createGame } = await import('../packages/engine/src/index.js');
  const source = {
    name: 'Source fixture',
    type: 'creature',
    cost: {},
    power: 1,
    toughness: 1,
    triggers: [{ event: 'selfEnters', target: 'player', effects: [{ op: 'damage', amount: 1 }] }],
  };
  const bounce = {
    name: 'Bounce fixture',
    type: 'instant',
    cost: {},
    target: 'creature',
    effects: [{ op: 'bounce' }],
  };
  const config = {
    catalog: { ...CARDS, [source.name]: source, [bounce.name]: bounce },
    mulligan: false,
    decks: [
      [...Array(56).fill('Island'), ...Array(4).fill(source.name)],
      [...Array(56).fill('Forest'), ...Array(4).fill(bounce.name)],
    ],
  };
  let seed;
  for (seed = 1; seed < 100; seed++) {
    const state = createGame({ ...config, seed });
    if (
      state.players[0].hand.some((id) => state.objects[id].name === source.name) &&
      state.players[1].hand.some((id) => state.objects[id].name === bounce.name)
    )
      break;
  }
  assert.ok(seed < 100);
  const session = createSession({ ...config, seed });
  const step = (command) => {
    const c = session.context();
    const result = session.step({ player: c.player, ...command });
    assert.equal(result.ok, true, JSON.stringify(result.error));
  };
  // First player skips the entire draw step.
  for (let i = 0; i < 2; i++) step({ type: 'pass' });
  let c = session.context();
  step(
    c.actions.find((a) => a.type === 'cast' && c.observation.objects[a.card].name === source.name),
  );
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  assert.equal(c.observation.choice.kind, 'triggerTarget');
  step({ type: 'chooseTriggerTarget', target: { kind: 'player', id: 1 } });
  step({ type: 'pass' });
  c = session.context();
  const target = Object.values(c.observation.objects).find(
    (o) => o.name === source.name && o.zone === 'battlefield',
  );
  step(c.actions.find((a) => a.type === 'cast' && a.target.id === target.id));
  step({ type: 'pass' });
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  assert.equal(c.player, 1);
  const reference = c.observation.stack[0].source;
  assert.match(reference.id, /^object:/);
  assert.equal(c.observation.objects[reference.id], undefined);
  assert.equal(/"c\d+"/.test(JSON.stringify(c.observation)), false);
  const result = session.step({
    type: 'cast',
    player: 1,
    card: c.observation.players[1].hand[0],
    target: reference,
  });
  assert.equal(result.error.code, 'AGENT_HANDLE');
});

test('library-search observations expose eligible opaque handles and hide them again afterward', async () => {
  const { DECKS, expandDeck, chooseBotCommand } = await import('../packages/engine/src/index.js');
  const session = createSession({
    seed: 1,
    decks: [expandDeck(DECKS.roots.cards), expandDeck(DECKS.ember.cards)],
  });
  let c;
  for (let i = 0; i < 300; i++) {
    c = session.context();
    assert.ok(c);
    if (c.observation.choice?.kind === 'librarySearch') break;
    const command = chooseBotCommand(c.observation, c.player);
    assert.equal(session.step(command).ok, true);
  }
  assert.equal(c.observation.choice.kind, 'librarySearch');
  assert.equal(/"c\d+"/.test(JSON.stringify(c)), false);
  const ids = c.observation.choice.cards;
  assert.ok(ids.length);
  assert.ok(ids.every((id) => id.startsWith('object:') && c.observation.objects[id]?.name));
  const command = chooseBotCommand(c.observation, c.player);
  assert.equal(session.step(command).ok, true);
  const after = session.context();
  assert.ok(after);
  const visible = Object.values(after.observation.objects);
  assert.equal(
    visible.some((o) => o.zone === 'library'),
    false,
  );
});
