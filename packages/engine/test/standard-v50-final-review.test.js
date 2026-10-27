import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, ref, stats } from '../src/index.js';
import { move, notifyTriggers } from '../src/model.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';

function rich() {
  const s = fixture();
  for (const p of s.players) for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[color] = 20;
  return s;
}
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefield(s, o);
  stabilize(s);
  return o;
}

test('Monoist requires both targets initially but resolves the surviving group if one becomes illegal', () => {
  let s = rich();
  enter(s, 'Monoist Circuit-Feeder');
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  for (const lostGroup of ['friendly', 'enemy']) {
    s = rich();
    const friendly = put(s, 'Grizzly Bears');
    const enemy = put(s, 'Serra Angel', 1);
    enter(s, 'Monoist Circuit-Feeder');
    s = act(s, 'chooseTriggerTargets', {
      targets: { friendly: [ref(friendly)], enemy: [ref(enemy)] },
    });
    move(s, s.objects[(lostGroup === 'friendly' ? friendly : enemy).id], 'hand');
    s = resolve(s);
    if (lostGroup === 'friendly')
      assert.deepEqual(stats(s, s.objects[enemy.id]), { power: 4, toughness: 3 });
    else assert.deepEqual(stats(s, s.objects[friendly.id]), { power: 3, toughness: 2 });
  }
});

test('Super Suit still untaps the target when its Equipment leaves before resolution', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears');
  target.tapped = true;
  const suit = enter(s, 'Super Suit');
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  move(s, s.objects[suit.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].tapped, false);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 2, toughness: 2 });
});

test('Static Snare never exiles its target if the enchantment left before the ETB resolves', () => {
  let s = rich();
  const target = put(s, 'Basilisk Collar', 1);
  const snare = enter(s, 'Static Snare');
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  move(s, s.objects[snare.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
  assert.equal(s.linkedExiles?.length ?? 0, 0);
});

test('Shady Informant only has its death trigger if it was face up immediately before leaving', () => {
  for (const faceUp of [false, true]) {
    let s = rich();
    const informant = put(s, 'Shady Informant', 0, 'hand');
    s = resolve(act(s, 'cast', { card: informant.id, mode: 1 }));
    assert.equal(s.objects[informant.id].faceDown, true);
    if (faceUp) s = act(s, 'turnFaceUp', { card: informant.id });
    move(s, s.objects[informant.id], 'graveyard');
    stabilize(s);
    if (faceUp) {
      assert.equal(s.choice.kind, 'triggerTarget');
      s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
      s = resolve(s);
      assert.equal(s.players[1].life, 18);
    } else {
      assert.equal(s.stack.length, 0);
      assert.equal(s.choice, null);
      assert.equal(s.players[1].life, 20);
    }
  }
});

test('Wildwood Mentor uses departure power, excludes itself, and ignores a returned incarnation', () => {
  let s = rich();
  const mentor = put(s, 'Wildwood Mentor');
  const target = put(s, 'Grizzly Bears');
  s.combat.attackers = [ref(mentor), ref(target)];
  notifyTriggers(s, 'attack', { object: mentor });
  stabilize(s);
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(mentor) }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s.objects[mentor.id].plusCounters = 4;
  move(s, s.objects[mentor.id], 'graveyard');
  enterBattlefield(s, s.objects[mentor.id]);
  s.objects[mentor.id].plusCounters = 9;
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 7, toughness: 7 });
});

test('Shepherd checks Mount only at resolution and does not return instant or sorcery cards', () => {
  let s = rich();
  const mount = put(s, 'Sizzling Changeling');
  const permanent = put(s, 'Forest', 0, 'graveyard');
  const instant = put(s, 'Lightning Bolt', 0, 'graveyard');
  enter(s, 'Shepherd of the Clouds');
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(instant) }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(permanent) });
  move(s, s.objects[mount.id], 'hand');
  s = resolve(s);
  assert.equal(s.objects[permanent.id].zone, 'hand');
});

test('Unending Whisper harmonize taps a summoning-sick creature to reduce only generic mana and exiles', () => {
  let s = fixture();
  s.players[0].mana.U = 1;
  const creature = put(s, 'Shivan Dragon', 0, 'battlefield', { ready: false });
  const spell = put(s, 'Unending Whisper', 0, 'graveyard');
  s = act(s, 'cast', { card: spell.id, harmonize: ref(creature) });
  assert.equal(s.objects[creature.id].tapped, true);
  assert.equal(s.players[0].mana.U, 0);
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'exile');
  assert.equal(s.players[0].hand.length, 1);
});

test('Sally counts nontoken creatures only at resolution, excluding a departed Sally', () => {
  let s = rich();
  const sally = enter(s, 'Sally Pride, Lioness Leader');
  move(s, s.objects[sally.id], 'graveyard');
  put(s, 'Grizzly Bears');
  put(s, 'Mutant Token');
  s = resolve(s);
  const tokens = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'Mutant Token',
  );
  assert.equal(tokens.length, 2);
});
