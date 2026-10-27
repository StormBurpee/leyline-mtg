import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  dispatch,
  exportReplay,
  replay,
  chooseBotCommand,
  legalActions,
  playerView,
  CARDS,
} from '../src/index.js';
import {
  addLoreCounters,
  definition,
  move,
  ref,
  playableZone,
  notifyTriggers,
} from '../src/model.js';
import { enterBattlefield, resolveTop, stabilize, resolveEffects } from '../src/effects.js';
import { finishCleanup, nextTurn, advanceStep, clearMana } from '../src/turn.js';
import { manaValue } from '../src/mana-value.js';
import { pay } from '../src/mana.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { decisionReader } from '../../../apps/web/choice-stage.js';
import { fixture, put, act } from './helpers.js';
const NAME = 'The Legend of Roku // Avatar Roku';
function enter(s, controller = 0) {
  const o = put(s, NAME, 0, 'hand');
  enterBattlefield(s, o, controller);
  stabilize(s);
  return o;
}
function settle(s) {
  resolveTop(s);
  stabilize(s);
}
function chapter(s, o) {
  addLoreCounters(s, o);
  stabilize(s);
  settle(s);
}

test('Roku exiles three with real costs/timing and permission lasts through the next controller turn', () => {
  const s = fixture();
  const top = s.players[0].library.slice(0, 3);
  const o = enter(s);
  settle(s);
  assert.deepEqual(s.players[0].exile.slice(-3), top);
  assert.ok(top.every((id) => playableZone(s, s.objects[id], 0)));
  move(s, o, 'graveyard');
  finishCleanup(s);
  assert.equal(s.active, 1);
  assert.ok(top.every((id) => playableZone(s, s.objects[id], 0)));
  nextTurn(s);
  assert.equal(s.active, 0);
  assert.ok(top.every((id) => playableZone(s, s.objects[id], 0)));
  finishCleanup(s);
  assert.ok(top.every((id) => !playableZone(s, s.objects[id], 0)));
});

test('Roku mana choice offers five colors, rejects stale/invalid commands and bot handles it', () => {
  let s = fixture();
  const o = enter(s);
  settle(s);
  chapter(s, o);
  assert.equal(s.choice.kind, 'manaColor');
  assert.equal(legalActions(s, 0).length, 5);
  assert.equal(dispatch(s, { type: 'chooseManaColor', player: 0, color: 'C' }).ok, false);
  assert.equal(dispatch(s, { type: 'chooseManaColor', player: 1, color: 'R' }).ok, false);
  assert.equal(chooseBotCommand(s, 0).type, 'chooseManaColor');
  assert.deepEqual(playerView(s, 1).choice, { kind: 'manaColor', player: 0, card: o.id });
  s = act(s, 'chooseManaColor', { color: 'U' });
  assert.equal(s.players[0].mana.U, 1);
  assert.equal(s.choice, null);
  assert.equal(dispatch(s, { type: 'chooseManaColor', player: 0, color: 'R' }).ok, false);
});

test('third chapter exiles and returns back face under ability controller with front-face mana value', () => {
  let s = fixture();
  const o = enter(s, 1);
  settle(s);
  chapter(s, o);
  s = act(s, 'chooseManaColor', { color: 'R' }, 1);
  const current = s.objects[o.id];
  const old = ref(current);
  chapter(s, current);
  assert.equal(current.zone, 'battlefield');
  assert.equal(current.controller, 1);
  assert.equal(current.incarnation, old.incarnation + 2);
  assert.equal(current.transformed, true);
  assert.equal(definition(s, current).name, 'Avatar Roku');
  assert.equal(definition(s, current).legendary, true);
  assert.deepEqual(definition(s, current).color, []);
  assert.equal(manaValue(definition(s, current)), 4);
  assert.equal(current.loreCounters, undefined);
  assert.match(decisionReader(s, current.id, {}, 1), /Avatar Roku/);
  assert.match(decisionReader(s, current.id, {}, 1), /Firebending 4/);
  move(s, current, 'hand');
  assert.equal(current.transformed, undefined);
  assert.equal(definition(s, current).name, 'The Legend of Roku');
});

test('old Saga incarnation cannot transform a new object and token copies cannot return from exile', () => {
  const s = fixture();
  const o = enter(s);
  settle(s);
  const old = ref(o);
  move(s, o, 'hand');
  enterBattlefield(s, o);
  s.pendingTriggers = [];
  s.stack = [];
  resolveEffects(s, { source: old, controller: 0, effects: [{ op: 'returnTransformed' }] });
  assert.equal(o.transformed, undefined);
  o.token = true;
  resolveEffects(s, { source: ref(o), controller: 0, effects: [{ op: 'returnTransformed' }] });
  assert.equal(o.zone, 'exile');
});

test('firebending uses attack trigger stack and red mana persists through combat, not postcombat main', () => {
  const s = fixture();
  const dragon = put(s, 'Firebending Dragon Token');
  s.step = 'attackers';
  notifyTriggers(s, 'attack', { object: dragon });
  stabilize(s);
  assert.equal(s.stack.length, 1);
  assert.equal(s.players[0].restrictedMana?.length ?? 0, 0);
  settle(s);
  assert.equal(s.players[0].restrictedMana.length, 4);
  clearMana(s);
  assert.equal(s.players[0].restrictedMana.length, 4);
  pay(s, 0, { R: 1, generic: 1 });
  assert.equal(s.players[0].restrictedMana.length, 2);
  s.step = 'damage';
  advanceStep(s);
  assert.equal(s.step, 'endCombat');
  assert.equal(s.players[0].restrictedMana.length, 2);
  advanceStep(s);
  assert.equal(s.step, 'main2');
  assert.equal(s.players[0].restrictedMana.length, 0);
});

test('Roku Dragon activation creates the complete flying firebending token', () => {
  let s = fixture();
  const o = put(s, NAME);
  o.transformed = true;
  s.players[0].mana.R = 8;
  s = act(s, 'activate', { card: o.id, ability: 0 });
  settle(s);
  const dragon = Object.values(s.objects).find((o) => o.name === 'Firebending Dragon Token');
  assert.equal(dragon.zone, 'battlefield');
  assert.equal(definition(s, dragon).power, 4);
  assert.ok(definition(s, dragon).keywords.includes('flying'));
  assert.deepEqual(definition(s, dragon).triggers[0].effects, [{ op: 'combatMana', count: 4 }]);
});

test('native transform authoring round-trips without broadening support', () => {
  const native = CARDS[NAME];
  const source = sourceFromDefinition(native, {
    id: 'test:roku',
    idsByName: { 'Firebending Dragon Token': 'dragon' },
  });
  const compiled = compileCard(source, { identities: { dragon: 'Firebending Dragon Token' } });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(canonical(compiled.definition), canonical(native));
  const transform = source.abilities.find((a) => a.kind === 'transformFace');
  transform.back.abilities.push(transform);
  assert.equal(compileCard(source).ok, false);
});

test('Roku complete gameplay bot choices and face state replay exactly', () => {
  const deck = [...Array(20).fill('Mountain'), ...Array(4).fill(NAME)];
  let s = createGame({ decks: [deck, deck], mulligan: false, seed: 77, minimumDeckSize: 24 });
  for (let i = 0; i < 400 && s.status === 'playing'; i++) {
    const command = chooseBotCommand(s, s.choice?.player ?? s.priority);
    const result = dispatch(s, command);
    assert.equal(result.ok, true, result.error?.message);
    s = result.state;
  }
  assert.ok(s.history.some((c) => c.type === 'chooseManaColor'));
  assert.ok(
    s.events.some((e) => e.type === 'zoneChange' && e.from === 'battlefield' && e.to === 'exile'),
  );
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('Roku deck traverses the opaque agent session boundary without exposing hidden cards', async () => {
  const { runEpisode } = await import('../../simulation/run.js');
  const deck = [...Array(20).fill('Mountain'), ...Array(4).fill(NAME)];
  const result = await runEpisode({
    config: { decks: [deck, deck], seed: 77, mulligan: false, minimumDeckSize: 24 },
    includeReplay: true,
  });
  assert.equal(result.termination, 'finished', JSON.stringify(result.error));
  assert.ok(result.replay.commands.some((c) => c.type === 'chooseManaColor'));
  assert.equal(replay(result.replay).winner, result.winner);
});

test('registry normalizes native back faces and validates their token references', async () => {
  const { createRegistry } = await import('../src/index.js');
  const source = structuredClone(CARDS[NAME]);
  for (const key of ['keywords', 'types', 'subtypes', 'text', 'color']) delete source.backFace[key];
  const registry = createRegistry([source, CARDS['Firebending Dragon Token']]);
  assert.deepEqual(registry[NAME].backFace.keywords, []);
  assert.deepEqual(registry[NAME].backFace.types, ['creature']);
  assert.throws(() => createRegistry([source]), /token|Token/);
});
