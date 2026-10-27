import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  createGame,
  dispatch,
  exportReplay,
  replay,
  chooseBotCommand,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createSession } from '../packages/simulation/session.js';
import { cardDropPlan } from '../apps/web/drop-plan.js';
import { fixture, put, lands } from '../packages/engine/test/helpers.js';

test('X and repeated X round-trip through declarative source without becoming fixed costs', async () => {
  for (const name of [
    'Mind Spring',
    'Pedal to the Metal',
    'Slice from the Shadows',
    'Traumatic Critique',
    'Procrastinate',
    'Primal Might',
  ]) {
    const file = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${file}.json`, import.meta.url), 'utf8'),
    );
    const first = compileCard(source);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const second = compileCard(sourceFromDefinition(first.definition, { id: source.id }));
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(second.definition, first.definition);
  }
  const def = {
    name: 'XX fixture',
    type: 'sorcery',
    cost: { X: 2, U: 1 },
    effects: [{ op: 'draw', count: { kind: 'x' } }],
    text: 'Draw X cards.',
    keywords: [],
    subtypes: [],
    color: ['U'],
  };
  const source = sourceFromDefinition(def, { id: 'test:xx' });
  assert.equal(source.characteristics.manaCost, '{X}{X}{U}');
  assert.equal(compileCard(source).definition.cost.X, 2);
});

test('opaque proposals carry X unchanged and privileged replay reproduces its locked effect', () => {
  const catalog = { ...CARDS, 'Mind Spring': { ...CARDS['Mind Spring'], cost: { X: 1 } } };
  let session;
  for (let seed = 1; seed < 100; seed++) {
    session = createSession({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [...Array(4).fill('Mind Spring'), ...Array(56).fill('Island')],
        Array(60).fill('Forest'),
      ],
    });
    if (Object.values(session.context().observation.objects).some((o) => o.name === 'Mind Spring'))
      break;
  }
  let c = session.context();
  while (c.observation.step !== 'main1') {
    assert.equal(session.step({ type: 'pass', player: c.player }).ok, true);
    c = session.context();
  }
  assert.equal(session.step(c.actions.find((a) => a.type === 'playLand')).ok, true);
  c = session.context();
  const action = c.actions.find((a) => a.type === 'cast' && a.x === 1);
  assert.ok(action);
  assert.match(action.card, /^object:/);
  assert.equal(session.step(action).ok, true);
  c = session.context();
  assert.equal(c.observation.stack.at(-1).x, 1);
  assert.equal(c.observation.stack.at(-1).castingCost.generic, 1);
  for (let i = 0; i < 2; i++) {
    c = session.context();
    assert.equal(session.step({ type: 'pass', player: c.player }).ok, true);
  }
  const record = session.exportReplay(),
    state = replay(record);
  assert.equal(record.commands.find((c) => c.type === 'cast').x, 1);
  assert.equal(state.revision, session.context().revision);
});

test('dragging an X spell opens announcement rather than silently choosing zero', () => {
  const s = fixture();
  lands(s, 'Island', 4);
  const card = put(s, 'Mind Spring', 0, 'hand');
  const plan = cardDropPlan(s, 0, card.id);
  assert.equal(plan.kind, 'chooseX');
  assert.equal(plan.destinations.length, 1);
  assert.equal(plan.destinations[0].x, undefined);
});
