import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  legalActions,
  dispatch,
  chooseBotCommand,
  stats,
  playerView,
} from '../packages/engine/src/index.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefield, stabilize } from '../packages/engine/src/effects.js';
import { ref, move, notifyTriggers } from '../packages/engine/src/model.js';
function enter(s, name) {
  const source = put(s, name, 0, 'hand');
  enterBattlefield(s, source, 0);
  stabilize(s);
  return source;
}
function pick(s, mode, target) {
  s = act(s, 'chooseTriggerMode', { mode });
  if (target) s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  return s;
}
const end = (s) => {
  notifyTriggers(s, 'step', { step: 'end', player: s.active });
  stabilize(s);
  return s;
};
test('Charming Prince scry and life modes resolve independently, with private scry ordering', () => {
  let s = fixture();
  enter(s, 'Charming Prince');
  assert.deepEqual(s.choice.modes, [0, 1]);
  s = resolve(pick(s, 0));
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 2);
  assert.equal(playerView(s, 1).choice.kind, 'opponentChoice');
  s = act(s, 'orderLibrary', { top: [...s.choice.cards].reverse(), rest: [] });
  assert.equal(s.players[0].life, 20);
  s = fixture();
  enter(s, 'Charming Prince');
  s = resolve(pick(s, 1));
  assert.equal(s.players[0].life, 23);
});
test('Charming Prince targets another OWNED creature including stolen one, and returns it under your control', () => {
  let s = fixture();
  const stolen = put(s, 'Grizzly Bears');
  stolen.controller = 1;
  const borrowed = put(s, 'Llanowar Elves', 1);
  borrowed.controller = 0;
  const prince = enter(s, 'Charming Prince');
  s = pick(s, 2);
  assert.deepEqual(s.choice.targets, [ref(stolen)]);
  for (const target of [prince, borrowed])
    assert.equal(
      dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(target) }).ok,
      false,
    );
  s = act(s, 'chooseTriggerTarget', { target: ref(stolen) });
  move(s, s.objects[prince.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[stolen.id].zone, 'exile');
  end(s);
  s = resolve(s);
  assert.equal(s.objects[stolen.id].zone, 'battlefield');
  assert.equal(s.objects[stolen.id].controller, 0);
});
test('Kykar noncreature CAST chooses a mode before its spell resolves and creates a white flying Spirit', () => {
  let s = fixture();
  const kykar = put(s, 'Kykar, Zephyr Awakener'),
    shock = put(s, 'Shock', 0, 'hand');
  s.players[0].mana.R = 1;
  s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.length, 1);
  assert.equal(s.choice.kind, 'triggerMode');
  assert.deepEqual(s.choice.modes, [1]);
  s = pick(s, 1);
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'White Flying Spirit Token');
  assert.ok(token?.token);
  assert.equal(token.zone, 'battlefield');
  assert.deepEqual(CARDS[token.name].color, ['W']);
  assert.deepEqual(CARDS[token.name].keywords, ['flying']);
  assert.deepEqual(stats(s, token), { power: 1, toughness: 1 });
  assert.equal(s.players[1].life, 20);
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
  assert.ok(CARDS[kykar.name].keywords.includes('flying'));
  const creature = put(s, 'Ornithopter', 0, 'hand');
  s = act(s, 'cast', { card: creature.id });
  assert.equal(s.choice, null);
});
test('Kykar blink uses CONTROL not ownership and returns a borrowed creature to its owner', () => {
  let s = fixture();
  const kykar = put(s, 'Kykar, Zephyr Awakener'),
    borrowed = put(s, 'Grizzly Bears', 1);
  borrowed.controller = 0;
  const stolen = put(s, 'Llanowar Elves');
  stolen.controller = 1;
  const shock = put(s, 'Shock', 0, 'hand');
  s.players[0].mana.R = 1;
  s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 1 } });
  s = pick(s, 0);
  assert.deepEqual(s.choice.targets, [ref(borrowed)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(borrowed) });
  move(s, s.objects[kykar.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[borrowed.id].zone, 'exile');
  s = resolve(s);
  end(s);
  s = resolve(s);
  assert.equal(s.objects[borrowed.id].controller, 1);
});
test('Kykar does not trigger on opponent casts, and losing blink target never switches to Spirit mode', () => {
  let s = fixture();
  put(s, 'Kykar, Zephyr Awakener');
  const ally = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Shock', 1, 'hand');
  s.priority = 1;
  s.players[1].mana.R = 1;
  s = act(s, 'cast', { card: enemy.id, target: { kind: 'player', id: 0 } });
  assert.equal(s.choice, null);
  s = resolve(s);
  const own = put(s, 'Shock', 0, 'hand');
  s.players[0].mana.R = 1;
  s = act(s, 'cast', { card: own.id, target: { kind: 'player', id: 1 } });
  s = pick(s, 0, ally);
  move(s, s.objects[ally.id], 'hand');
  move(s, s.objects[ally.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[ally.id].zone, 'battlefield');
  assert.equal(
    Object.values(s.objects).some((o) => o.name === 'White Flying Spirit Token'),
    false,
  );
});
test('Oltec Archaeologists returns only your artifact card or scries exactly three', () => {
  let s = fixture();
  const artifact = put(s, 'Expedition Map', 0, 'graveyard');
  put(s, 'Expedition Map', 1, 'graveyard');
  put(s, 'Grizzly Bears', 0, 'graveyard');
  enter(s, 'Oltec Archaeologists');
  s = pick(s, 0);
  assert.deepEqual(s.choice.targets, [ref(artifact)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(artifact) });
  s = resolve(s);
  assert.equal(s.objects[artifact.id].zone, 'hand');
  s = fixture();
  enter(s, 'Oltec Archaeologists');
  assert.deepEqual(s.choice.modes, [1]);
  s = resolve(pick(s, 1));
  assert.equal(s.choice.cards.length, 3);
  s = act(s, 'orderLibrary', { top: [], rest: [...s.choice.cards] });
  assert.equal(s.choice, null);
});
test('Oltec Matterweaver creates an artifact Gnome or copies only your artifact token at creature casting', () => {
  let s = fixture();
  put(s, 'Oltec Matterweaver');
  const creature = put(s, 'Ornithopter', 0, 'hand');
  s = act(s, 'cast', { card: creature.id });
  assert.deepEqual(s.choice.modes, [0]);
  s = resolve(pick(s, 0));
  const gnome = Object.values(s.objects).find((o) => o.name === 'Artifact Gnome Token');
  assert.ok(gnome?.token);
  assert.deepEqual(CARDS[gnome.name].types, ['artifact', 'creature']);
  s = resolve(s);
  const second = put(s, 'Ornithopter', 0, 'hand');
  put(s, 'Artifact Gnome Token', 1);
  put(s, 'Soldier Token');
  s = act(s, 'cast', { card: second.id });
  s = pick(s, 1);
  assert.deepEqual(s.choice.targets, [ref(gnome)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(gnome) });
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) =>
        o.zone === 'battlefield' &&
        o.token &&
        o.controller === 0 &&
        (o.name === 'Artifact Gnome Token' || o.definitionOverride?.subtypes?.includes('Gnome')),
    ).length,
    2,
  );
});
test('White Widow counters up to two creatures on either side, including none, or returns artifact/enchantment', () => {
  for (const count of [0, 1, 2]) {
    let s = fixture();
    const own = put(s, 'Grizzly Bears'),
      enemy = put(s, 'Grizzly Bears', 1);
    enter(s, 'White Widow, Free Agent');
    s = pick(s, 0);
    s = act(s, 'chooseTriggerTargets', {
      targets: { creatures: [own, enemy].slice(0, count).map(ref) },
    });
    s = resolve(s);
    assert.equal(s.objects[own.id].plusCounters, count >= 1 ? 1 : 0);
    assert.equal(s.objects[enemy.id].plusCounters, count === 2 ? 1 : 0);
  }
  let s = fixture();
  const enchantment = put(s, 'Glorious Anthem', 0, 'graveyard');
  enter(s, 'White Widow, Free Agent');
  s = resolve(pick(s, 1, enchantment));
  assert.equal(s.objects[enchantment.id].zone, 'hand');
});
test('Yuriko has flash; graveyard size is read at resolution, while surveil remains a private separate mode', () => {
  let s = fixture();
  const target = put(s, 'Serra Angel', 1);
  put(s, 'Forest', 0, 'graveyard');
  enter(s, 'Yuriko, Hope from the Shadows');
  s = pick(s, 0, target);
  put(s, 'Shock', 0, 'graveyard');
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 2, toughness: 4 });
  assert.ok(CARDS['Yuriko, Hope from the Shadows'].keywords.includes('flash'));
  s = fixture();
  enter(s, 'Yuriko, Hope from the Shadows');
  s = resolve(pick(s, 1));
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.action, 'surveil');
  assert.equal(s.choice.cards.length, 2);
  const cards = [...s.choice.cards];
  s = act(s, 'orderLibrary', { top: [cards[0]], rest: [cards[1]] });
  assert.equal(s.objects[cards[1]].zone, 'graveyard');
});
test('Sylvan Scavenging offers the conditional token mode even without power four, checking only at resolution', () => {
  let s = fixture();
  put(s, 'Sylvan Scavenging');
  end(s);
  assert.deepEqual(s.choice.modes, [1]);
  s = resolve(pick(s, 1));
  assert.equal(
    Object.values(s.objects).some((o) => o.name === 'Green Raccoon Token'),
    false,
  );
  s = fixture();
  put(s, 'Sylvan Scavenging');
  const bear = put(s, 'Grizzly Bears');
  end(s);
  s = pick(s, 1);
  s.objects[bear.id].plusCounters = 2;
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'Green Raccoon Token');
  assert.ok(token);
  assert.deepEqual(stats(s, token), { power: 3, toughness: 3 });
  s = fixture();
  put(s, 'Sylvan Scavenging');
  const large = put(s, 'Serra Angel');
  end(s);
  s = pick(s, 1);
  move(s, s.objects[large.id], 'hand');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).some((o) => o.name === 'Green Raccoon Token'),
    false,
  );
});
test('Sylvan Scavenging only triggers on your end step and its counter mode targets a creature you control', () => {
  let s = fixture();
  put(s, 'Sylvan Scavenging');
  const own = put(s, 'Grizzly Bears');
  put(s, 'Grizzly Bears', 1);
  notifyTriggers(s, 'step', { step: 'end', player: 1 });
  stabilize(s);
  assert.equal(s.choice, null);
  end(s);
  s = pick(s, 0);
  assert.deepEqual(s.choice.targets, [ref(own)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(own) });
  s = resolve(s);
  assert.equal(s.objects[own.id].plusCounters, 1);
});
