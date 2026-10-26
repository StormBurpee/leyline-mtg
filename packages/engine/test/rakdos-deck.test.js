import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, resolve } from './helpers.js';
import { hasKeyword, move, ref } from '../src/model.js';
import { enterBattlefieldBatch, enterBattlefield } from '../src/effects.js';
import { finishCleanup } from '../src/turn.js';
import { manaOptions } from '../src/mana.js';

test('Stingerquill Charm creates a named colorless Cadet with temporary, not intrinsic haste', () => {
  let s = fixture();
  put(s, 'Mountain');
  put(s, 'Swamp');
  const card = put(s, 'Stingerquill Charm', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id, mode: 2 }));
  const token = Object.values(s.objects).find((o) => o.name === 'Cadet');
  assert.ok(token?.token);
  assert.equal(hasKeyword(s, token, 'haste'), true);
  finishCleanup(s);
  assert.equal(hasKeyword(s, token, 'haste'), false);
});
test('Stingerquill Charm supports both targeted modes', () => {
  for (const mode of [0, 1]) {
    let s = fixture();
    put(s, 'Mountain');
    put(s, 'Swamp');
    const creature = put(s, 'Grizzly Bears');
    const card = put(s, 'Stingerquill Charm', 0, 'hand');
    s = resolve(
      act(s, 'cast', {
        card: card.id,
        mode,
        target: mode === 0 ? { kind: 'player', id: 1 } : ref(creature),
      }),
    );
    if (!mode) assert.equal(s.players[1].life, 17);
    else {
      assert.equal(hasKeyword(s, s.objects[creature.id], 'first strike'), true);
      assert.equal(hasKeyword(s, s.objects[creature.id], 'deathtouch'), true);
    }
  }
});
test('Haunted Ridge checks other lands before entry, including simultaneous entries', () => {
  const s = fixture();
  put(s, 'Mountain');
  const ridge = put(s, 'Haunted Ridge', 0, 'hand');
  const swamp = put(s, 'Swamp', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: ridge }, { object: swamp }]);
  assert.equal(ridge.tapped, true);
  move(s, ridge, 'hand');
  enterBattlefield(s, ridge);
  assert.equal(ridge.tapped, false);
});
test('Blazemire Verge red mana follows actual land subtypes', () => {
  const s = fixture();
  const verge = put(s, 'Blazemire Verge');
  put(s, 'Haunted Ridge');
  assert.deepEqual(manaOptions(s, verge), ['B']);
  const swamp = put(s, 'Swamp');
  assert.deepEqual(manaOptions(s, verge), ['B', 'R']);
  move(s, swamp, 'graveyard');
  assert.deepEqual(manaOptions(s, verge), ['B']);
});

test('Flamecache Gecko needs actual life loss and discards as an activation cost', async () => {
  const { loseLife } = await import('../src/model.js');
  const { stabilize } = await import('../src/effects.js');
  const { dispatch, legalActions } = await import('../src/index.js');
  let s = fixture();
  loseLife(s, 1, 1);
  const gecko = put(s, 'Flamecache Gecko', 0, 'hand');
  enterBattlefield(s, gecko);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].mana.B, 1);
  assert.equal(s.players[0].mana.R, 1);
  const fodder = put(s, 'Mountain', 0, 'hand');
  const command = legalActions(s, 0).find(
    (a) => a.type === 'activate' && a.card === gecko.id && a.discardCard === fodder.id,
  );
  assert.ok(command);
  assert.equal(dispatch(s, { type: 'activate', player: 0, card: gecko.id, ability: 0 }).ok, false);
  s = act(s, 'activate', command);
  assert.equal(s.objects[fodder.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, 0);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('Hired Claw triggers once per attack group and limits activations by turn and incarnation', async () => {
  const { declareAttackers } = await import('../src/combat.js');
  const { stabilize } = await import('../src/effects.js');
  const { abilityProblem } = await import('../src/engine.js');
  let s = fixture();
  const claw = put(s, 'Hired Claw');
  const gecko = put(s, 'Flamecache Gecko');
  put(s, 'Mountain');
  put(s, 'Mountain');
  s.step = 'attackers';
  declareAttackers(s, [claw.id, gecko.id]);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  s = act(s, 'activate', { card: claw.id, ability: 0 });
  assert.match(abilityProblem(s, 0, claw.id, 0), /already/);
  s = resolve(s);
  assert.equal(s.objects[claw.id].plusCounters, 1);
});
test('Gev counters check life-loss history and Valley modifies both combat and noncombat damage', async () => {
  const { loseLife } = await import('../src/model.js');
  const { dealDamage } = await import('../src/effects.js');
  const s = fixture();
  put(s, 'Gev, Scaled Scorch');
  put(s, 'Valley Flamecaller');
  loseLife(s, 1, 1);
  const claw = put(s, 'Hired Claw', 0, 'hand');
  enterBattlefield(s, claw);
  assert.equal(claw.plusCounters, 1);
  dealDamage(s, { id: claw.id, controller: 0, keywords: [] }, { kind: 'player', id: 1 }, 1);
  assert.equal(s.players[1].life, 17);
  dealDamage(s, { id: claw.id, controller: 0, keywords: [] }, { kind: 'player', id: 1 }, 1, true);
  assert.equal(s.players[1].life, 15);
});
test('speed uses a once-per-own-turn intrinsic trigger, persists without Gastal, and grants max-speed keywords', async () => {
  const { loseLife } = await import('../src/model.js');
  const { stabilize } = await import('../src/effects.js');
  let s = fixture();
  const gastal = put(s, 'Gastal Thrillseeker');
  stabilize(s);
  assert.equal(s.players[0].speed, 1);
  loseLife(s, 1, 1);
  loseLife(s, 1, 1);
  stabilize(s);
  assert.equal(s.stack.length, 1);
  assert.equal(s.players[0].speed, 1);
  s = resolve(s);
  assert.equal(s.players[0].speed, 2);
  move(s, s.objects[gastal.id], 'graveyard');
  s.turn++;
  loseLife(s, 1, 1);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].speed, 3);
  s.turn++;
  loseLife(s, 1, 1);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].speed, 4);
  const other = put(s, 'Gastal Thrillseeker');
  assert.equal(hasKeyword(s, other, 'haste'), true);
  assert.equal(hasKeyword(s, other, 'deathtouch'), true);
});
test('kicker pays an additional four and offspring produces a 1/1 copy with landfall', async () => {
  let s = fixture();
  for (let i = 0; i < 5; i++) put(s, 'Mountain');
  const spell = put(s, 'Burst Lightning', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, mode: 1, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].life, 16);
  s = fixture();
  put(s, 'Swamp');
  put(s, 'Mountain');
  put(s, 'Mountain');
  const vine = put(s, 'Iridescent Vinelasher', 0, 'hand');
  s = resolve(act(s, 'cast', { card: vine.id, mode: 1 }));
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  const copy = Object.values(s.objects).find((o) => o.name === vine.name && o.token);
  assert.ok(copy);
  assert.equal(copy.definitionOverride.power, 1);
  assert.equal(copy.definitionOverride.toughness, 1);
});

test('Cavern chooses a type on entry and only its restricted mana protects matching creature spells', async () => {
  const { dispatch } = await import('../src/index.js');
  let s = fixture();
  const cavern = put(s, 'Cavern of Souls', 0, 'hand');
  s = act(s, 'playLand', { card: cavern.id });
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.objects[cavern.id].zone, 'hand');
  s = act(s, 'chooseCreatureType', { creatureType: 'Lizard' });
  assert.equal(s.objects[cavern.id].chosenCreatureType, 'Lizard');
  const claw = put(s, 'Hired Claw', 0, 'hand');
  const burst = put(s, 'Burst Lightning', 0, 'hand');
  s = act(s, 'tapMana', { card: cavern.id, color: 'R' });
  assert.equal(s.players[0].mana.R, 0);
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: burst.id, target: { kind: 'player', id: 1 } }).ok,
    false,
  );
  s = act(s, 'cast', { card: claw.id });
  assert.equal(s.stack.at(-1).uncounterable, true);
  assert.equal(s.players[0].restrictedMana.length, 0);
});
test('Rockface creature mana cannot pay its own pump or an instant', async () => {
  const { dispatch } = await import('../src/index.js');
  let s = fixture();
  const village = put(s, 'Rockface Village');
  const claw = put(s, 'Hired Claw');
  const bolt = put(s, 'Burst Lightning', 0, 'hand');
  s = act(s, 'tapMana', { card: village.id, color: 'R' });
  s.objects[village.id].tapped = false;
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: village.id, ability: 0, target: ref(claw) })
      .ok,
    false,
  );
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: bolt.id, target: { kind: 'player', id: 1 } }).ok,
    false,
  );
});

test('Fireglass exile permission applies only to the chosen incarnation this turn', async () => {
  const { notifyTriggers, loseLife, playableZone } = await import('../src/model.js');
  const { stabilize } = await import('../src/effects.js');
  let s = fixture();
  put(s, 'Fireglass Mentor');
  loseLife(s, 1, 1);
  notifyTriggers(s, 'step', { player: 0, step: 'main2' });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'exilePlay');
  const [picked, other] = s.choice.cards;
  s = act(s, 'chooseResolutionCard', { card: picked });
  assert.equal(playableZone(s, s.objects[picked], 0), true);
  assert.equal(playableZone(s, s.objects[other], 0), false);
  move(s, s.objects[picked], 'graveyard');
  move(s, s.objects[picked], 'exile');
  assert.equal(playableZone(s, s.objects[picked], 0), false);
});
test('Binding Negotiation reveals only during resolution and has the optional exile fallback', async () => {
  const { playerView } = await import('../src/index.js');
  let s = fixture();
  put(s, 'Swamp');
  put(s, 'Mountain');
  const spell = put(s, 'Binding Negotiation', 0, 'hand');
  const enemy = put(s, 'Hired Claw', 1, 'hand');
  const exiled = put(s, 'Mountain', 1, 'exile');
  s = resolve(act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } }));
  assert.equal(playerView(s, 0).objects[enemy.id].name, 'Hired Claw');
  s = act(s, 'chooseResolutionCard', { card: null });
  assert.equal(s.choice.kind, 'exileToGraveyard');
  s = act(s, 'chooseResolutionCard', { card: exiled.id });
  assert.equal(s.objects[exiled.id].zone, 'graveyard');
  assert.equal(playerView(s, 0).objects[enemy.id], undefined);
});
test('disguise conceals identity, is a nameless colorless 2/2 with ward, and turns up without the stack', async () => {
  const { definition, playerView } = await import('../src/index.js');
  let s = fixture();
  for (let i = 0; i < 4; i++) put(s, 'Mountain');
  const performer = put(s, 'Pyrotechnic Performer', 0, 'hand');
  s = act(s, 'cast', { card: performer.id, mode: 1 });
  assert.equal(s.stack.at(-1).name, 'Face-down creature');
  let view = playerView(s, 1);
  assert.equal(view.objects[performer.id].name, 'Face-down creature');
  delete view.catalog;
  assert.equal(JSON.stringify(view).includes('"name":"Pyrotechnic Performer"'), false);
  s = resolve(s);
  assert.equal(definition(s, s.objects[performer.id]).power, 2);
  assert.deepEqual(definition(s, s.objects[performer.id]).subtypes, []);
  s = act(s, 'turnFaceUp', { card: performer.id });
  assert.equal(s.objects[performer.id].faceDown, undefined);
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].kind, 'ability');
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
});
