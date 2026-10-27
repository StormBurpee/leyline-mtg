import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  createGame,
  plotProblem,
  castProblem,
  castingProfile,
  legalActions,
  dispatch,
  replay,
  exportReplay,
  stats,
  chooseBotCommand,
} from '../src/index.js';
import { move, playableCards } from '../src/model.js';
import { finishCleanup } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { handCard, game } from '../../../apps/web/view.js';
import { cardDropPlan } from '../../../apps/web/drop-plan.js';

const later = (s) => {
  finishCleanup(s);
  finishCleanup(s);
  s.step = 'main1';
  return s;
};
test('plot is a paid, face-up special action, retains priority, and records no spell', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const o = put(s, 'Slickshot Show-Off', 0, 'hand');
  assert.ok(legalActions(s, 0).some((a) => a.type === 'plot' && a.card === o.id));
  s = act(s, 'plot', { card: o.id });
  assert.equal(s.stack.length, 0);
  assert.equal(s.priority, 0);
  assert.equal(s.objects[o.id].zone, 'exile');
  assert.ok(!s.objects[o.id].faceDown);
  assert.equal(s.players[0].spellsCast, undefined);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Mountain' && o.tapped).length, 2);
  assert.match(castProblem(s, 0, o.id), /later turn/);
  assert.ok(dispatch(s, { type: 'plot', player: 0, card: o.id }).error);
  later(s);
  assert.ok(s.objects[o.id].plotted);
  assert.equal(castProblem(s, 0, o.id), null);
  s = act(s, 'cast', { card: o.id });
  assert.equal(s.players[0].spellsCast.profiles[0].count, 1);
  assert.equal(s.objects[o.id].plotted, undefined);
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'battlefield');
});
test('plot and plotted casting enforce ownership, priority, sorcery windows and incarnation', () => {
  let s = fixture();
  lands(s, 'Island', 4);
  const o = put(s, "Djinn of Fool's Fall", 0, 'hand');
  s.step = 'upkeep';
  assert.match(plotProblem(s, 0, o.id), /sorcery/);
  s.step = 'main1';
  assert.ok(plotProblem(s, 1, o.id));
  s = act(s, 'plot', { card: o.id });
  later(s);
  s.priority = 1;
  assert.ok(castProblem(s, 1, o.id));
  s.priority = 0;
  move(s, s.objects[o.id], 'hand');
  move(s, s.objects[o.id], 'exile');
  assert.equal(s.objects[o.id].plotted, undefined);
  assert.ok(castProblem(s, 0, o.id));
});
const instant = {
  name: 'Plot instant',
  type: 'instant',
  cost: { U: 1 },
  plot: {},
  target: 'any',
  effects: [{ op: 'damage', amount: 2 }],
};
const config = {
  mulligan: false,
  minimumDeckSize: 7,
  decks: [0, 1].map(() => [...Array(4).fill(instant.name), ...Array(20).fill('Island')]),
  catalog: createRegistry([instant, CARDS.Island]),
};
test('plotted instants still require own main phase empty stack and legal targets', () => {
  let s = createGame(config);
  s.step = 'main1';
  const id = s.players[0].hand.find((id) => s.objects[id].name === instant.name);
  s = act(s, 'plot', { card: id });
  later(s);
  const target = { kind: 'player', id: 1 };
  assert.ok(castProblem(s, 0, id));
  assert.equal(castProblem(s, 0, id, target), null);
  s.active = 1;
  assert.match(castProblem(s, 0, id, target), /main phase/);
  s.active = 0;
  s.step = 'upkeep';
  assert.match(castProblem(s, 0, id, target), /main phase/);
  s.step = 'main1';
  s.stack.push({ id: 'test' });
  assert.match(castProblem(s, 0, id, target), /main phase/);
  s.stack = [];
  assert.match(handCard(s, id, {}, { selected: null, chosen: [] }, true), /plotted in exile/);
  assert.ok(playableCards(s, 0).includes(id));
  assert.ok(cardDropPlan(s, 0, id).destinations.some((a) => a.target?.id === 1));
  s = resolve(act(s, 'cast', { card: id, target }));
  assert.equal(s.players[1].life, 18);
  assert.equal(s.objects[id].zone, 'graveyard');
});
test('free plotted cost still pays tax; plotting is not taxed as casting', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const tax = put(s, 'Grizzly Bears', 1);
  tax.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    costModifiers: [{ scope: 'opponent', change: 'increase', amount: 2 }],
  };
  const o = put(s, 'Slickshot Show-Off', 0, 'hand');
  s = act(s, 'plot', { card: o.id });
  later(s);
  assert.deepEqual(castingProfile(s, 0, s.objects[o.id]).cost, { generic: 2 });
  for (const o of Object.values(s.objects)) if (o.name === 'Mountain') o.tapped = true;
  assert.match(castProblem(s, 0, o.id), /mana/);
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: o.id });
  assert.equal(s.stack.length, 1);
});
test('source plot rejects unknown costs, duplicates, X and alternative/additional combinations', async () => {
  const { compileCard } = await import('../../cards/compiler.js');
  const { readFile } = await import('node:fs/promises');
  const source = JSON.parse(
    await readFile(new URL('../../cards/cards/slickshot-show-off.json', import.meta.url)),
  );
  for (const ability of [
    { kind: 'plot', cost: '{R}', discard: 1 },
    { kind: 'plot', cost: '{X}{R}' },
  ])
    assert.equal(compileCard({ ...source, abilities: [ability] }).ok, false);
  assert.equal(
    compileCard({ ...source, abilities: [...source.abilities, { kind: 'plot', cost: '{R}' }] }).ok,
    false,
  );
  for (const extra of [
    { cost: { X: 1 } },
    { kicker: { cost: { R: 1 }, effects: [] } },
    { offspring: { generic: 1 } },
    { disguise: { generic: 1 } },
    { flashback: { U: 1 } },
  ])
    assert.throws(() => createRegistry([{ ...instant, ...extra }]));
});
test('real card clauses are retained after plotting and casting', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const paladin = put(s, 'Spinewoods Paladin', 0, 'hand');
  s = act(s, 'plot', { card: paladin.id });
  later(s);
  s = resolve(act(s, 'cast', { card: paladin.id }));
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
  const terror = put(s, 'Stingerback Terror');
  put(s, 'Island', 0, 'hand');
  assert.equal(stats(s, terror).power, 6);
  const slick = put(s, 'Slickshot Show-Off');
  lands(s, 'Mountain', 1);
  const shock = put(s, 'Shock', 0, 'hand');
  s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[slick.id]).power, 3);
});
test('opaque plot actions and full later-turn cast replay deterministically', async () => {
  const { createSession } = await import('../../simulation/session.js');
  const session = createSession(config);
  const step = (a) => {
    const r = session.step({ player: session.context().player, ...a });
    assert.equal(r.ok, true, JSON.stringify(r));
  };
  const advance = () => {
    const c = session.context();
    step(
      c.observation.choice?.kind === 'attackers'
        ? { type: 'attackers', cards: [] }
        : c.observation.choice?.kind === 'blockers'
          ? { type: 'blockers', pairs: [] }
          : c.observation.choice?.kind === 'discard'
            ? {
                type: 'discard',
                cards: c.observation.players[c.player].hand.slice(0, c.observation.choice.count),
              }
            : { type: 'pass' },
    );
  };
  while (!session.context().actions.some((a) => a.type === 'plot')) advance();
  const plot = session.context().actions.find((a) => a.type === 'plot');
  assert.match(plot.card, /^object:/);
  step(plot);
  while (
    !session
      .context()
      .actions.some(
        (a) => a.type === 'cast' && session.context().observation.players[0].exile.includes(a.card),
      )
  )
    advance();
  step(
    session
      .context()
      .actions.find(
        (a) => a.type === 'cast' && session.context().observation.players[0].exile.includes(a.card),
      ),
  );
  // The replay exported by the session includes opaque commands mapped back to canonical IDs.
  const record = session.exportReplay();
  assert.deepEqual(exportReplay(replay(record)), record);
});
test('plot stage provides a special-action button, persistent exile label, and later-turn guidance', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const o = put(s, 'Beastbond Outcaster', 0, 'hand');
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
    selected: o.id,
  };
  assert.match(game(s, ui, {}), /data-action="plotSelected"/);
  s = act(s, 'plot', { card: o.id });
  const html = game(s, ui, {});
  assert.match(html, /Plotted · exile/);
  assert.match(html, /later turn/);
  assert.doesNotMatch(html, /data-action="plotSelected"/);
  assert.match(html, /data-action="playSelected" disabled/);
  later(s);
  assert.doesNotMatch(game(s, ui, {}), /data-action="playSelected" disabled/);
});
test('Beastbond intervening power condition is checked at entry and at trigger resolution', () => {
  for (const withLarge of [false, true]) {
    let s = fixture();
    lands(s, 'Forest', 2);
    const o = put(s, 'Beastbond Outcaster', 0, 'hand');
    const large = withLarge ? put(s, 'Spinewoods Paladin') : null;
    s = act(s, 'plot', { card: o.id });
    later(s);
    s = resolve(act(s, 'cast', { card: o.id }));
    assert.equal(s.stack.length, withLarge ? 1 : 0);
    if (withLarge) {
      move(s, s.objects[large.id], 'graveyard');
      s = resolve(s);
      assert.equal(s.players[0].hand.length, 0);
    }
  }
  let s = fixture();
  lands(s, 'Forest', 3);
  put(s, 'Spinewoods Paladin');
  const o = put(s, 'Beastbond Outcaster', 0, 'hand');
  s = resolve(act(s, 'cast', { card: o.id }));
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('bot can plot a cheaper card instead of passing when casting is unavailable', () => {
  const s = fixture();
  lands(s, 'Island', 4);
  const o = put(s, "Djinn of Fool's Fall", 0, 'hand');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'plot');
  assert.equal(command.card, o.id);
});
test('all five complete plot sources preserve native definitions through roundtrip', async () => {
  const { compileCard } = await import('../../cards/compiler.js');
  const { sourceFromDefinition } = await import('../../cards/from-native.js');
  for (const name of [
    'Beastbond Outcaster',
    "Djinn of Fool's Fall",
    'Slickshot Show-Off',
    'Spinewoods Paladin',
    'Stingerback Terror',
  ]) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: '19a32e29-45ec-433e-9cb4-b2c32cac8f80' }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const { canonical } = await import('../../cards/compiler.js');
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]));
  }
});
