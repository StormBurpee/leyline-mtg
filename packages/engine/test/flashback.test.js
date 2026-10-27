import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  createGame,
  castProblem,
  castingProfile,
  stats,
  keywords,
  ref,
  chooseBotCommand,
  replay,
  exportReplay,
} from '../src/index.js';
import { move, playableCards } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { cardDropPlan } from '../../../apps/web/drop-plan.js';
import { handCard } from '../../../apps/web/view.js';

test('normal cast uses printed cost and graveyard cast uses flashback then exiles', () => {
  let s = fixture();
  lands(s, 'Island', 5);
  const card = put(s, 'Think Twice', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, card).cost, { generic: 1, U: 1 });
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.objects[card.id].zone, 'graveyard');
  assert.deepEqual(castingProfile(s, 0, s.objects[card.id]).cost, { generic: 2, U: 1 });
  s = act(s, 'cast', { card: card.id });
  assert.equal(s.stack.at(-1).flashbackPaid, true);
  assert.equal(s.objects[card.id].controller, 0);
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'exile');
  assert.equal(s.objects[card.id].flashbackPaid, undefined);
  assert.ok(castProblem(s, 0, card.id));
});

test('countered flashback and every other stack departure exile instead', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  lands(s, 'Island', 2, 1);
  const card = put(s, 'Think Twice', 0, 'graveyard');
  const counter = put(s, 'Negate', 1, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target: { kind: 'stack', id: s.stack[0].id } });
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'exile');
  for (const destination of ['hand', 'library', 'graveyard', 'battlefield']) {
    const t = fixture();
    const o = put(t, 'Think Twice', 0, 'stack');
    o.flashbackPaid = true;
    move(t, o, destination);
    assert.equal(o.zone, 'exile');
  }
});

test('graveyard permission requires owner and flashback; other zones never grant permission', () => {
  const s = fixture();
  lands(s, 'Island', 9);
  for (const zone of ['library', 'exile', 'battlefield']) {
    const card = put(s, 'Think Twice', 0, zone);
    assert.ok(castProblem(s, 0, card.id));
  }
  assert.ok(castProblem(s, 0, put(s, 'Think Twice', 1, 'graveyard').id));
  assert.ok(castProblem(s, 0, put(s, 'Opt', 0, 'graveyard').id));
});

test('flashback obeys timing, targeting and generic reducers', () => {
  let s = fixture();
  lands(s, 'Mountain', 4);
  put(s, 'Mocking Sprite');
  const card = put(s, 'Tome Blast', 0, 'graveyard');
  const target = { kind: 'player', id: 1 };
  assert.deepEqual(castingProfile(s, 0, card).cost, { generic: 3, R: 1 });
  assert.ok(castProblem(s, 0, card.id));
  s.step = 'upkeep';
  assert.match(castProblem(s, 0, card.id, target), /main phase/);
  s.step = 'main1';
  assert.equal(castProblem(s, 0, card.id, target), null);
  s = resolve(act(s, 'cast', { card: card.id, target }));
  assert.equal(s.players[1].life, 18);
  assert.equal(s.objects[card.id].zone, 'exile');
});

test('graveyard UI target continuation and bot use normal legal cast commands', () => {
  let s = fixture();
  lands(s, 'Mountain', 5);
  const card = put(s, 'Tome Blast', 0, 'graveyard');
  s.players[1].life = 2;
  assert.ok(playableCards(s, 0).includes(card.id));
  const markup = handCard(s, card.id, {}, { selected: null, chosen: [] }, true);
  assert.match(markup, /flashback from graveyard/);
  assert.match(markup, /data-motion-zone="graveyard"/);
  const plan = cardDropPlan(s, 0, card.id);
  const action = plan.destinations.find((a) => a.target?.kind === 'player' && a.target.id === 1);
  assert.ok(action);
  assert.equal(chooseBotCommand(s, 0).card, card.id);
  s = resolve(act(s, action.type, action));
  assert.equal(s.winner, 0);
});

test('invalidated flashback target fizzles into exile', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const card = put(s, 'Dig Site Inventory', 0, 'graveyard');
  const target = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: card.id, target: ref(target) });
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'exile');
});

const free = { name: 'Flashback fixture', type: 'instant', cost: {}, flashback: {}, effects: [] };
const config = {
  mulligan: false,
  minimumDeckSize: 7,
  decks: [0, 1].map(() => [...Array(4).fill(free.name), ...Array(3).fill('Island')]),
  catalog: createRegistry([free, CARDS.Island]),
};
test('flashback replay retains paid marker and deterministic zone transitions', () => {
  let s = createGame(config);
  const id = s.players[0].hand.find((id) => s.objects[id].name === free.name);
  s = resolve(act(s, 'cast', { card: id }));
  s = resolve(act(s, 'cast', { card: id }));
  assert.equal(s.objects[id].zone, 'exile');
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('opaque session actions can cast from graveyard', async () => {
  const { createSession } = await import('../../simulation/session.js');
  const session = createSession(config);
  const step = (action) =>
    assert.equal(session.step({ player: session.context().player, ...action }).ok, true);
  let c = session.context();
  step(c.actions.find((a) => a.type === 'cast'));
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  const id = c.observation.players[c.player].graveyard[0];
  assert.match(id, /^object:/);
  step(c.actions.find((a) => a.type === 'cast' && a.card === id));
  step({ type: 'pass' });
  step({ type: 'pass' });
  assert.equal(session.context().observation.players[0].exile.length, 1);
});

test('flashback fails closed for unsupported combinations and additional costs', () => {
  assert.throws(() => createRegistry([{ ...free, flashback: { discard: 1 } }]));
  assert.throws(() => createRegistry([{ ...free, kicker: { cost: {}, effects: [] } }]));
  assert.throws(() => createRegistry([{ ...free, type: 'creature', power: 1, toughness: 1 }]));
});

test('Dreams of Laguna keeps flashback identity across the surveil continuation', () => {
  let s = fixture();
  lands(s, 'Island', 4);
  const card = put(s, 'Dreams of Laguna', 0, 'graveyard');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.action, 'surveil');
  assert.equal(s.objects[card.id].zone, 'stack');
  const top = s.choice.cards[0],
    next = s.players[0].library[1];
  s = act(s, 'orderLibrary', { top: [], rest: [top] });
  assert.equal(s.objects[top].zone, 'graveyard');
  assert.equal(s.players[0].hand[0], next);
  assert.equal(s.objects[card.id].zone, 'exile');
});

test('Dig Site Inventory resolves both the counter and vigilance from graveyard', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const card = put(s, 'Dig Site Inventory', 0, 'graveyard');
  const target = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'cast', { card: card.id, target: ref(target) }));
  assert.equal(s.objects[target.id].plusCounters, 1);
  assert.ok(keywords(s, s.objects[target.id]).includes('vigilance'));
  assert.equal(s.objects[card.id].zone, 'exile');
});

test('instant flashback can be cast on an opponent turn without changing ownership', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const card = put(s, 'Think Twice', 0, 'graveyard');
  s.active = 1;
  s.step = 'upkeep';
  assert.equal(castProblem(s, 0, card.id), null);
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.objects[card.id].owner, 0);
  assert.ok(s.players[0].exile.includes(card.id));
});

test('Auron’s Inspiration buffs only attacking creatures, including opposing attackers', () => {
  let s = fixture();
  lands(s, 'Plains', 4);
  const card = put(s, "Auron's Inspiration", 0, 'graveyard');
  const attacker = put(s, 'Grizzly Bears', 1);
  const idle = put(s, 'Grizzly Bears');
  s.combat.attackers = [ref(attacker)];
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(stats(s, s.objects[attacker.id]).power, 4);
  assert.equal(stats(s, s.objects[idle.id]).power, 2);
  assert.equal(s.objects[card.id].zone, 'exile');
});

test('source compiler rejects additional flashback costs, X and duplicate abilities', async () => {
  const { compileCard } = await import('../../cards/compiler.js');
  const { readFile } = await import('node:fs/promises');
  const source = JSON.parse(
    await readFile(new URL('../../cards/cards/think-twice.json', import.meta.url), 'utf8'),
  );
  for (const extra of [
    [{ kind: 'flashback', cost: '{U}', discard: 1 }],
    [{ kind: 'flashback', cost: '{X}{U}' }],
    [source.abilities[1], source.abilities[1]],
  ])
    assert.equal(compileCard({ ...source, abilities: [source.abilities[0], ...extra] }).ok, false);
});
