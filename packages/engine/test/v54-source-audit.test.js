import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, dispatch, ref, stats, keywords, playerView } from '../src/index.js';
import { move, tapObjects } from '../src/model.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';

function rich() {
  const s = fixture();
  for (const player of s.players)
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) player.mana[color] = 100;
  return s;
}
function enter(s, name, player = 0) {
  const object = put(s, name, player, 'hand');
  enterBattlefield(s, object, player);
  stabilize(s);
  return object;
}
function top(s, names, player = 0) {
  const ids = names.map((name) => put(s, name, player, 'library').id);
  s.players[player].library = [
    ...ids,
    ...s.players[player].library.filter((id) => !ids.includes(id)),
  ];
  return ids;
}
function rejectUnchanged(s, command) {
  const before = structuredClone(s);
  const result = dispatch(s, { player: s.priority, ...command });
  assert.equal(result.ok, false);
  assert.deepEqual(s, before);
}

test('Cauldron targets before paying and cannot reanimate its own chosen sacrifice', () => {
  const s = rich();
  const source = put(s, 'Cauldron of Essence'),
    victim = put(s, 'Grizzly Bears');
  rejectUnchanged(s, {
    type: 'activate',
    card: source.id,
    ability: 0,
    target: ref(victim),
    sacrifices: [ref(victim)],
  });
});

test('Cauldron uses the sacrifice controller rather than owner and keeps paid costs after a stale target', () => {
  let s = rich();
  const source = put(s, 'Cauldron of Essence'),
    victim = put(s, 'Grizzly Bears', 1),
    target = put(s, 'Serra Angel', 0, 'graveyard');
  victim.controller = 0;
  s = act(s, 'activate', {
    card: source.id,
    ability: 0,
    target: ref(target),
    sacrifices: [ref(victim)],
  });
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.ok(s.players[1].graveyard.includes(victim.id));
  move(s, s.objects[target.id], 'exile');
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'exile');
  assert.equal(s.objects[source.id].tapped, true);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});

for (const [name, victims] of [
  ['Dutiful Griffin', ['Pacifism', 'Pacifism']],
  ['Gollum the Abandoned', ['Grizzly Bears']],
])
  test(`${name} does not return a new graveyard incarnation after paying its sacrifices`, () => {
    let s = rich();
    const source = put(s, name, 0, 'graveyard');
    const sacrifices = victims.map((name) => put(s, name));
    s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: sacrifices.map(ref) });
    move(s, s.objects[source.id], 'exile');
    move(s, s.objects[source.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[source.id].zone, 'graveyard');
    for (const victim of sacrifices) assert.equal(s.objects[victim.id].zone, 'graveyard');
  });

for (const name of [
  'Bartolomé del Presidio',
  'Unburied Earthcarver',
  "Vito's Inquisitor",
  'Metalhead',
])
  test(`${name} cannot modify a returned source incarnation`, () => {
    let s = rich();
    const source = put(s, name),
      victim = put(s, 'Artifact Gnome Token');
    s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(victim)] });
    move(s, s.objects[source.id], 'exile');
    move(s, s.objects[source.id], 'battlefield');
    s = resolve(s);
    assert.equal(s.objects[source.id].plusCounters, 0);
    assert.deepEqual(stats(s, s.objects[source.id]), {
      power: CARDS[name].power,
      toughness: CARDS[name].toughness,
    });
    assert.ok(!keywords(s, s.objects[source.id]).includes('menace'));
  });

test('Immersturm Predator requires a fresh tap and loses the whole optional-target trigger if its chosen card leaves', () => {
  let s = rich();
  const predator = put(s, 'Immersturm Predator'),
    dead = put(s, 'Grizzly Bears', 1, 'graveyard');
  tapObjects(s, [predator]);
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(dead)] } });
  move(s, s.objects[dead.id], 'exile');
  s = resolve(s);
  assert.equal(s.objects[predator.id].plusCounters, 0);
  tapObjects(s, [s.objects[predator.id]]);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  assert.equal(s.choice, null);
});

test('Gollum may omit its graveyard target but a chosen stale target prevents the life loss', () => {
  for (const selected of [false, true]) {
    let s = rich();
    const card = put(s, 'Grizzly Bears', 1, 'graveyard');
    enter(s, 'Gollum the Abandoned');
    s = act(s, 'chooseTriggerTargets', { targets: { chosen: selected ? [ref(card)] : [] } });
    if (selected) move(s, s.objects[card.id], 'exile');
    s = resolve(s);
    assert.equal(s.players[1].life, selected ? 20 : 18);
  }
});

test('Threefold Thunderhulk uses its last battlefield power, not its returned incarnation', () => {
  let s = rich();
  const source = enter(s, 'Threefold Thunderhulk');
  source.plusCounters = 5;
  move(s, source, 'exile');
  move(s, source, 'battlefield');
  source.plusCounters = 1;
  s = resolve(s);
  const tokens = Object.values(s.objects).filter(
    (o) => o.name === 'Artifact Gnome Token' && o.zone === 'battlefield',
  );
  assert.equal(tokens.length, 5);
  assert.ok(tokens.every((o) => o.controller === 0 && o.token));
});

test('Metalhead returns a stolen artifact to its owner and allows no target', () => {
  for (const selected of [false, true]) {
    let s = rich();
    const artifact = put(s, 'Basilisk Collar', 1);
    artifact.controller = 0;
    enter(s, 'Metalhead');
    s = act(s, 'chooseTriggerTargets', { targets: { returned: selected ? [ref(artifact)] : [] } });
    s = resolve(s);
    assert.equal(s.objects[artifact.id].zone, selected ? 'hand' : 'battlefield');
    if (selected) assert.ok(s.players[1].hand.includes(artifact.id));
  }
});

test("Rakshasa's Bargain selects every remaining card from a short library without exposing a private look", () => {
  let s = rich();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
  const [id] = top(s, ['Grizzly Bears']);
  const source = put(s, "Rakshasa's Bargain", 0, 'hand');
  s = resolve(act(s, 'cast', { card: source.id }));
  assert.equal(s.choice.selectCount, 1);
  assert.equal(playerView(s, 1).objects[id], undefined);
  rejectUnchanged(s, { type: 'orderLibrary', top: [], rest: [id] });
  s = act(s, 'orderLibrary', { top: [id], rest: [] });
  assert.ok(s.players[0].hand.includes(id));
  assert.equal(s.winner, null);
});

test('Pictures of Spider-Man can decline both eligible cards without revealing them', () => {
  let s = rich();
  const cards = top(s, ['Grizzly Bears', 'Llanowar Elves', 'Island', 'Opt', 'Forest']);
  enter(s, 'Pictures of Spider-Man');
  s = resolve(s);
  assert.deepEqual(s.choice.eligibleCards, cards.slice(0, 2));
  assert.equal(s.choice.selectCount, 2);
  s = act(s, 'orderLibrary', { top: [], rest: [...cards].reverse() });
  assert.equal(s.players[0].hand.length, 0);
  assert.deepEqual(s.events.findLast((event) => event.type === 'lookChooseHand').revealed, []);
  for (const id of cards) assert.equal(playerView(s, 1).objects[id], undefined);
});
