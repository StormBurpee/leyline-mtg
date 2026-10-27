import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, ref, dispatch, stats } from '../src/index.js';
import { move } from '../src/model.js';
import { stabilize, enterBattlefield } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { castingChoices } from '../src/spell-modes.js';
import { fixture, put, act, resolve } from './helpers.js';

function rich() {
  const s = fixture();
  for (const p of s.players) for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[color] = 20;
  return s;
}
function endStep(s) {
  s.step = 'main2';
  advanceStep(s);
  stabilize(s);
  return s;
}

test('Explosive Getaway returns a stolen noncreature artifact to its owner, after the sweep', () => {
  let s = rich();
  const artifact = put(s, 'Basilisk Collar', 1);
  artifact.controller = 0;
  const creature = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Explosive Getaway', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, targets: { blink: [ref(artifact)] } }));
  assert.equal(s.objects[artifact.id].zone, 'exile');
  assert.equal(s.objects[creature.id].zone, 'graveyard');
  s = resolve(endStep(s));
  assert.equal(s.objects[artifact.id].zone, 'battlefield');
  assert.equal(s.objects[artifact.id].controller, 1);
});

test('Explosive Getaway fizzles its sweep if its chosen target becomes illegal', () => {
  let s = rich();
  const saved = put(s, 'Grizzly Bears');
  const other = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Explosive Getaway', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { blink: [ref(saved)] } });
  move(s, s.objects[saved.id], 'hand');
  s = resolve(s);
  assert.equal(s.objects[other.id].zone, 'battlefield');
  assert.equal(s.objects[other.id].damage, 0);
  assert.equal(s.delayedTriggers?.length ?? 0, 0);
});

test('Explosive Getaway never returns tokens or a different exile incarnation', () => {
  for (const token of [false, true]) {
    let s = rich();
    const saved = put(s, token ? 'Two Two Cat Token' : 'Grizzly Bears');
    const spell = put(s, 'Explosive Getaway', 0, 'hand');
    s = resolve(act(s, 'cast', { card: spell.id, targets: { blink: [ref(saved)] } }));
    if (token) {
      assert.equal(s.objects[saved.id], undefined);
      assert.equal(s.delayedTriggers?.length ?? 0, 0);
    } else {
      move(s, s.objects[saved.id], 'hand');
      move(s, s.objects[saved.id], 'exile');
      s = resolve(endStep(s));
      assert.equal(s.objects[saved.id].zone, 'exile');
    }
  }
});

test('Scour for Scrap has exactly three nonempty unrepeated choices, all at printed mana cost', () => {
  const choices = castingChoices(CARDS['Scour for Scrap']);
  assert.equal(choices.length, 3);
  assert.deepEqual(
    choices.map((choice) => choice.spreeModes),
    [[0], [1], [0, 1]],
  );
  for (const mode of [0, 1, 2]) {
    let s = fixture();
    s.players[0].mana.U = 1;
    s.players[0].mana.C = 3;
    const spell = put(s, 'Scour for Scrap', 0, 'hand');
    const artifact = put(s, 'Basilisk Collar', 0, 'graveyard');
    s = act(s, 'cast', {
      card: spell.id,
      mode,
      ...(mode ? { targets: { returned: [ref(artifact)] } } : {}),
    });
    assert.equal(s.players[0].mana.U + s.players[0].mana.C, 0);
    assert.equal(s.stack.length, 1);
  }
  const s = rich();
  const spell = put(s, 'Scour for Scrap', 0, 'hand');
  for (const mode of [-1, 3, [0, 0]])
    assert.equal(dispatch(s, { type: 'cast', player: 0, card: spell.id, mode }).ok, false);
});

test('Scour for Scrap both-mode search does not happen if its only graveyard target is illegal', () => {
  let s = rich();
  const spell = put(s, 'Scour for Scrap', 0, 'hand');
  const artifact = put(s, 'Basilisk Collar', 0, 'graveyard');
  s = act(s, 'cast', { card: spell.id, mode: 2, targets: { returned: [ref(artifact)] } });
  move(s, s.objects[artifact.id], 'exile');
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});

test('Ticket Tortoise rechecks its intervening-if land comparison on resolution', () => {
  const s = rich();
  const land = put(s, 'Forest', 1);
  const tortoise = put(s, 'Ticket Tortoise', 0, 'hand');
  enterBattlefield(s, tortoise, 0);
  stabilize(s);
  assert.equal(s.stack.length, 1);
  move(s, land, 'graveyard');
  const after = resolve(s);
  assert.equal(
    Object.values(after.objects).some(
      (o) => o.zone === 'battlefield' && o.name === 'Treasure Token',
    ),
    false,
  );
});

test('Council of Echoes rejects its own source and rechecks graveyard permanent count', () => {
  let s = rich();
  const grave = Array.from({ length: 4 }, () => put(s, 'Forest', 0, 'graveyard'));
  const council = put(s, 'Council of Echoes', 0, 'hand');
  const target = put(s, 'Grizzly Bears', 1);
  enterBattlefield(s, council, 0);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTargets', player: 0, targets: { chosen: [ref(council)] } })
      .ok,
    false,
  );
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(target)] } });
  move(s, s.objects[grave[0].id], 'exile');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
});

test('Oracle Gift charges both X mana symbols and ignores opponent Fractals', () => {
  let s = fixture();
  s.players[0].mana.U = 1;
  s.players[0].mana.C = 4;
  const enemy = put(s, 'Fractal Token', 1);
  enemy.plusCounters = 3;
  const jadzi = put(s, "Jadzi, Steward of Fate // Oracle's Gift", 0, 'hand');
  enterBattlefield(s, jadzi, 0);
  s.pendingTriggers = [];
  const copy = s.objects[jadzi.id].preparedCopy.id;
  s = resolve(act(s, 'cast', { card: copy, x: 2 }));
  assert.equal(s.players[0].mana.U + s.players[0].mana.C, 0);
  assert.deepEqual(stats(s, s.objects[enemy.id]), { power: 3, toughness: 3 });
  const own = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'Fractal Token' && o.controller === 0,
  );
  assert.equal(own.length, 2);
  for (const o of own) assert.deepEqual(stats(s, o), { power: 2, toughness: 2 });
});
