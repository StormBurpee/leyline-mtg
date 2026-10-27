import { createSession } from '../../simulation/session.js';
import { replay, exportReplay } from '../src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  playerView,
  ref,
  chooseBotCommand,
  dispatch,
  hasKeyword,
  stats,
} from '../src/index.js';
import { move } from '../src/model.js';
import { resolveEffects } from '../src/effects.js';
import { validateDefinition } from '../src/definition-validation.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
function library(s, names, player = 0) {
  for (const id of [...s.players[player].library]) move(s, s.objects[id], 'exile');
  return names.map((name) => put(s, name, player, 'library'));
}
function explore(s, creature, subject = 'source') {
  const entry = {
    kind: 'ability',
    name: creature.name,
    controller: 0,
    source: ref(creature),
    sourceController: creature.controller,
    effects: [{ op: 'explore', ...(subject === 'source' ? { subject } : {}) }],
    ...(subject === 'target' ? { target: ref(creature) } : {}),
  };
  resolveEffects(s, entry);
  return s;
}
test('explore reveals a land to both players, puts it into hand without draw, and empty library still counters', () => {
  let s = fixture();
  const c = put(s, 'Cenote Scout');
  const [land] = library(s, ['Forest']);
  explore(s, c);
  assert.equal(c.plusCounters, 0);
  assert.equal(land.zone, 'hand');
  assert.ok(s.events.some((e) => e.type === 'exploreRevealed' && e.revealed === 'Forest'));
  assert.ok(!s.events.some((e) => e.type === 'draw' && e.objectId === land.id));
  explore(s, c);
  assert.equal(c.plusCounters, 1);
  assert.equal(s.winner, null);
  assert.equal(s.choice, null);
});
test('nonland counter precedes the public large-card keep/graveyard choice; unrelated library cards stay opaque', () => {
  for (const graveyard of [false, true]) {
    let s = fixture();
    const c = put(s, 'Cenote Scout');
    const [card, next] = library(s, ['Opt', 'Forest']);
    explore(s, c);
    assert.equal(c.plusCounters, 1);
    assert.equal(s.choice.action, 'explore');
    const opponent = playerView(s, 1);
    assert.equal(opponent.objects[card.id].name, 'Opt');
    assert.equal(opponent.objects[next.id], undefined);
    assert.equal(opponent.choice.kind, 'opponentChoice');
    assert.throws(
      () => act(s, 'orderLibrary', { top: [card.id], rest: [card.id] }),
      /exactly once/,
    );
    s = act(s, 'orderLibrary', {
      top: graveyard ? [] : [card.id],
      rest: graveyard ? [card.id] : [],
    });
    assert.equal(s.objects[card.id].zone, graveyard ? 'graveyard' : 'library');
    assert.equal(s.choice, null);
  }
});
test('source explores after leaving using LKI but never counters its new incarnation', () => {
  const s = fixture(),
    c = put(s, 'Cenote Scout', 1);
  library(s, ['Opt'], 1);
  const entry = {
    kind: 'ability',
    name: c.name,
    controller: 0,
    source: ref(c),
    sourceController: 1,
    effects: [{ op: 'explore', subject: 'source' }],
  };
  move(s, c, 'graveyard');
  move(s, c, 'battlefield');
  resolveEffects(s, entry);
  assert.equal(s.choice.player, 1);
  assert.equal(c.plusCounters, 0);
});
test('Map pays mana, taps and sacrifices, has own creature targeting and sorcery timing', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const map = put(s, 'Map Token'),
    c = put(s, 'Cenote Scout'),
    enemy = put(s, 'Cenote Scout', 1);
  library(s, ['Opt']);
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: map.id, ability: 0, target: ref(enemy) }).ok,
    false,
  );
  s.step = 'upkeep';
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: map.id, ability: 0, target: ref(c) }).ok,
    false,
  );
  s.step = 'main1';
  s = act(s, 'activate', { card: map.id, ability: 0, target: ref(c) });
  assert.notEqual(s.objects[map.id]?.zone, 'battlefield');
  s = resolve(s);
  assert.equal(s.choice.action, 'explore');
  assert.equal(s.objects[c.id].plusCounters, 1);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'orderLibrary');
  assert.equal(dispatch(s, command).ok, true);
});
test('Map cannot explore a target that left and returned', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const map = put(s, 'Map Token'),
    c = put(s, 'Cenote Scout');
  library(s, ['Opt']);
  s = act(s, 'activate', { card: map.id, ability: 0, target: ref(c) });
  move(s, s.objects[c.id], 'graveyard');
  move(s, s.objects[c.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.objects[c.id].plusCounters, 0);
});
test('Get Lost gives two functional Maps to target controller, including indestructible survivor', () => {
  for (const indestructible of [false, true]) {
    let s = fixture();
    lands(s, 'Plains', 2);
    const c = put(s, 'Cenote Scout', 1),
      spell = put(s, 'Get Lost', 0, 'hand');
    if (indestructible)
      s.modifiers.push({
        objectId: c.id,
        incarnation: c.incarnation,
        power: 0,
        toughness: 0,
        keywords: ['indestructible'],
        expires: s.turn,
      });
    s = resolve(act(s, 'cast', { card: spell.id, target: ref(c) }));
    assert.equal(s.objects[c.id].zone, indestructible ? 'battlefield' : 'graveyard');
    const maps = Object.values(s.objects).filter(
      (o) => o.name === 'Map Token' && o.zone === 'battlefield',
    );
    assert.equal(maps.length, 2);
    assert.ok(maps.every((o) => o.controller === 1));
  }
});
test('Restless Anchorage preserves land mana and becomes a flying 2/3', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  lands(s, 'Island', 1);
  const c = put(s, 'Restless Anchorage');
  s = resolve(act(s, 'activate', { card: c.id, ability: 0 }));
  assert.deepEqual(stats(s, s.objects[c.id]), { power: 2, toughness: 3 });
  assert.ok(hasKeyword(s, s.objects[c.id], 'flying'));
});
test('explore native validation rejects player targets and invalid bindings', () => {
  assert.ok(
    validateDefinition({ ...CARDS.Opt, effects: [{ op: 'explore' }], target: 'player' }).length,
  );
  assert.ok(
    validateDefinition({ ...CARDS['Cenote Scout'], etb: [{ op: 'explore', subject: 'attached' }] })
      .length,
  );
});

test('twice-explore keeps the same nonland and adds a counter each time', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const c = put(s, 'Cenote Scout'),
    spell = put(s, 'Over the Edge', 0, 'hand');
  const [card] = library(s, ['Opt']);
  s = resolve(act(s, 'cast', { card: spell.id, mode: 1, target: ref(c) }));
  assert.equal(s.objects[c.id].plusCounters, 1);
  s = act(s, 'orderLibrary', { top: [card.id], rest: [] });
  assert.equal(s.objects[c.id].plusCounters, 2);
  assert.deepEqual(s.choice.cards, [card.id]);
  s = act(s, 'orderLibrary', { top: [], rest: [card.id] });
  assert.equal(s.choice, null);
  assert.equal(s.objects[card.id].zone, 'graveyard');
});
test('Spyglass Siren makes a fully functional Map on entry', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  const spell = put(s, 'Spyglass Siren', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id }));
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Map Token' && o.zone === 'battlefield')
      .length,
    1,
  );
});

test('bot uses Maps and never casts Get Lost just to destroy its own creature', () => {
  let s = fixture();
  lands(s, 'Plains', 3);
  const c = put(s, 'Cenote Scout'),
    map = put(s, 'Map Token');
  library(s, ['Opt']);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.card, map.id);
  assert.equal(command.target.id, c.id);
  move(s, map, 'exile');
  put(s, 'Get Lost', 0, 'hand');
  const next = chooseBotCommand(s, 0);
  assert.notEqual(next.type, 'cast');
});

test('real explore decisions and chosen graveyard movement roundtrip through opaque session replay', () => {
  let session;
  for (let seed = 1; seed < 80; seed++) {
    session = createSession({
      seed,
      mulligan: false,
      decks: [
        [
          ...Array(52).fill('Forest'),
          ...Array(4).fill('Cenote Scout'),
          ...Array(4).fill('Pathfinding Axejaw'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    for (let i = 0; i < 250; i++) {
      const c = session.context();
      if (!c) break;
      if (c.observation.choice?.action === 'explore') break;
      const r = session.step(chooseBotCommand(c.observation, c.player));
      assert.equal(r.ok, true, r.error?.message);
    }
    if (session.context()?.observation.choice?.action === 'explore') break;
  }
  const c = session.context();
  assert.equal(c.observation.choice.action, 'explore');
  const before = replay(session.exportReplay());
  assert.equal(before.choice.action, 'explore');
  assert.ok(c.observation.choice.cards.every((id) => id.startsWith('object:')));
  assert.equal(
    session.step({
      type: 'orderLibrary',
      player: c.player,
      top: [],
      rest: c.observation.choice.cards,
    }).ok,
    true,
  );
  const after = replay(session.exportReplay());
  assert.equal(after.choice, null);
  assert.ok(after.players[c.player].graveyard.length > 0);
  assert.deepEqual(replay(exportReplay(after)), after);
});
