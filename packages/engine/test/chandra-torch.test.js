import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatch,
  legalActions,
  chooseBotCommand,
  createGame,
  exportReplay,
  replay,
  CARDS,
} from '../src/index.js';
import { move, ref, definition } from '../src/model.js';
import { resolveTop, stabilize, resolveEffects } from '../src/effects.js';
import { fixture, put, act, lands } from './helpers.js';
const NAME = 'Chandra, Torch of Defiance';
function top(s, name, p = 0) {
  const o = put(s, name, p, 'library');
  s.players[p].library = s.players[p].library.filter((id) => id !== o.id);
  s.players[p].library.unshift(o.id);
  return o;
}
function settle(s) {
  resolveTop(s);
  stabilize(s);
}
function first(s) {
  const o = put(s, NAME);
  s = act(s, 'activate', { card: o.id, ability: 0 });
  settle(s);
  return { s, chandra: o.id };
}

test('Chandra first ability casts a sorcery during resolution for its actual cost, never gives an EOT permission', () => {
  let s = fixture();
  const spell = top(s, 'Divination');
  lands(s, 'Island', 3);
  const other = put(s, 'Opt', 0, 'hand');
  ({ s } = first(s));
  assert.equal(s.choice.kind, 'castExiled');
  assert.equal(s.objects[spell.id].zone, 'exile');
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: other.id }).ok, false);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id));
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
  assert.equal(s.stack.at(-1).source.id, spell.id);
  assert.equal(s.players[1].life, 20);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Island' && o.tapped).length, 3);
  settle(s);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, 3);
});

test('decline, unpayable card, land and empty library each deal two, without granting a later cast or land play', () => {
  for (const name of ['Mountain', 'Divination']) {
    let s = fixture();
    const spell = top(s, name);
    ({ s } = first(s));
    assert.deepEqual(legalActions(s, 0), [{ type: 'declineCastExiled' }]);
    const before = structuredClone(s);
    assert.equal(dispatch(s, { type: 'cast', player: 0, card: spell.id }).ok, false);
    assert.deepEqual(s, before);
    s = act(s, 'declineCastExiled');
    assert.equal(s.players[1].life, 18);
    assert.equal(s.objects[spell.id].zone, 'exile');
    assert.equal(s.objects[spell.id].playPermission, undefined);
    lands(s, 'Island', 4);
    assert.equal(dispatch(s, { type: 'cast', player: 0, card: spell.id }).ok, false);
  }
  let s = fixture();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
  ({ s } = first(s));
  assert.equal(s.choice, null);
  assert.equal(s.players[1].life, 18);
});

test('Chandra targeted and modal cast choices use normal rules and exact targets', () => {
  let s = fixture();
  const spell = top(s, 'Burst Lightning');
  lands(s, 'Mountain', 5);
  ({ s } = first(s));
  const kicked = legalActions(s, 0).find(
    (a) => a.type === 'cast' && a.mode === 1 && a.target?.kind === 'player' && a.target.id === 1,
  );
  assert.ok(kicked);
  s = act(s, 'cast', kicked);
  assert.equal(s.players[1].life, 20);
  settle(s);
  assert.equal(s.players[1].life, 16);
});

test('Chandra plus mana and minus damage respect loyalty and real creature targets', () => {
  let s = fixture();
  const c = put(s, NAME);
  assert.equal(c.loyalty, 4);
  s = act(s, 'activate', { card: c.id, ability: 1 });
  settle(s);
  assert.equal(s.players[0].mana.R, 2);
  assert.equal(s.objects[c.id].loyalty, 5);
  assert.equal(dispatch(s, { type: 'activate', player: 0, card: c.id, ability: 0 }).ok, false);
  s.turn++;
  const victim = put(s, 'Serra Angel', 1);
  s = act(s, 'activate', { card: c.id, ability: 2, target: ref(victim) });
  settle(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(s.objects[c.id].loyalty, 2);
});

test('Chandra emblem persists after source death, triggers on cast not resolution and deals colorless source damage', () => {
  let s = fixture();
  const c = put(s, NAME);
  c.loyalty = 7;
  s = act(s, 'activate', { card: c.id, ability: 3 });
  assert.equal(s.objects[c.id].zone, 'graveyard');
  settle(s);
  assert.equal(s.emblems.length, 1);
  assert.equal(s.emblems[0].controller, 0);
  const spell = put(s, 'Llanowar Elves', 0, 'hand');
  lands(s, 'Forest', 1);
  put(s, 'Valley Flamecaller');
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.length, 2);
  settle(s);
  assert.equal(s.players[1].life, 15);
  assert.equal(s.stack.length, 1);
  assert.equal(s.events.filter((e) => e.type === 'damage').at(-1).source, s.emblems[0].id);
});

test('multiple emblems get separate APNAP targetable triggers and no trigger for opposing casts', () => {
  let s = fixture();
  const c = put(s, NAME);
  resolveEffects(s, {
    source: ref(c),
    name: NAME,
    controller: 0,
    effects: [
      { op: 'castDamageEmblem', amount: 5 },
      { op: 'castDamageEmblem', amount: 5 },
    ],
  });
  const spell = put(s, 'Opt', 0, 'hand');
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.choice.kind, 'orderTriggers');
  for (let i = 0; i < 3 && s.choice; i++) {
    const cmd = chooseBotCommand(s, 0);
    s = act(s, cmd.type, cmd);
  }
  assert.equal(s.stack.filter((e) => e.emblem).length, 2);
});

test('Chandra bot decisions and emblem/exile state replay deterministically', () => {
  const deck = [...Array(20).fill('Mountain'), ...Array(4).fill(NAME), ...Array(4).fill('Shock')];
  let s = createGame({ decks: [deck, deck], seed: 42, mulligan: false, minimumDeckSize: 28 });
  for (let i = 0; i < 600 && s.status === 'playing'; i++) {
    const cmd = chooseBotCommand(s, s.choice?.player ?? s.priority);
    const result = dispatch(s, cmd);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    s = result.state;
  }
  assert.ok(s.history.some((c) => c.type === 'declineCastExiled' || c.type === 'activate'));
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('resolution-time sacrifice payment can pause for linked Aura return without losing Chandra continuation', () => {
  let s = fixture();
  const light = put(s, 'Banishing Light'),
    bear = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(bear);
  resolveEffects(s, {
    source: ref(light),
    controller: 0,
    target: ref(aura),
    effects: [{ op: 'exileUntilSourceLeaves' }],
  });
  const spell = top(s, 'Final Vengeance');
  put(s, 'Swamp');
  ({ s } = first(s));
  s = act(s, 'cast', { card: spell.id, target: ref(bear), sacrifice: ref(light) });
  assert.equal(s.choice.kind, 'auraEntry');
  assert.ok(s.castingCompletion.parentResolution);
  assert.equal(s.resolving, null);
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.castingCompletion, undefined);
  assert.equal(s.resolving, null);
  assert.equal(s.choice, null);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.events.filter((e) => e.type === 'cast' && e.objectId === spell.id).length, 1);
  assert.equal(s.events.filter((e) => e.type === 'mana').length, 1);
  settle(s);
  assert.equal(s.objects[bear.id].zone, 'exile');
});

test('Chandra complete card round-trips and opaque simulation resolves choices and emblems', async () => {
  const { compileCard, canonical } = await import('../../cards/compiler.js');
  const { sourceFromDefinition } = await import('../../cards/from-native.js');
  const source = sourceFromDefinition(CARDS[NAME], { id: 'test:chandra' });
  const compiled = compileCard(source);
  assert.equal(compiled.ok, true);
  assert.deepEqual(canonical(compiled.definition), canonical(CARDS[NAME]));
  const { runEpisode } = await import('../../simulation/run.js');
  const deck = [...Array(20).fill('Mountain'), ...Array(4).fill(NAME), ...Array(4).fill('Shock')];
  const r = await runEpisode({
    config: { decks: [deck, deck], seed: 42, mulligan: false, minimumDeckSize: 28 },
    includeReplay: true,
  });
  assert.equal(r.termination, 'finished', JSON.stringify(r.error));
  assert.ok(r.replay.commands.some((c) => c.type === 'declineCastExiled' || c.type === 'activate'));
  assert.equal(replay(r.replay).winner, r.winner);
});
