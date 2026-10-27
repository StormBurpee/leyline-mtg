import {
  move,
  notifyTriggers,
  sagaFinalChapter,
  addLoreCounters,
  untapObject,
  skipsUntap,
  controlled,
  draw,
  emit,
  emptyMana,
  hasKeyword,
  opponent,
  STEPS,
} from './model.js';
import { beginDamage, combatants } from './combat.js';
import { stabilize, stateBasedActions, flushLinkedReturns } from './effects.js';
export function clearMana(s) {
  for (const p of s.players) {
    p.mana = emptyMana();
    p.restrictedMana = (p.restrictedMana ?? []).filter(
      (unit) =>
        unit.duration === 'combat' &&
        ['beginCombat', 'attackers', 'blockers', 'firstDamage', 'damage'].includes(s.step),
    );
  }
}
export function nextTurn(s) {
  s.active = opponent(s.active);
  s.turn++;
  for (const o of Object.values(s.objects))
    if (o.playPermission?.untilNextTurn === s.active) {
      o.playPermission.turn = s.turn;
      o.playPermission.nextTurnStarted = true;
    }
  // Until your next turn ends before untapping or any turn-start priority.
  s.modifiers = s.modifiers.filter((m) => m.untilNextTurn !== s.active);
  for (const player of s.players) {
    delete player.spellsCast;
    delete player.cardsDrawn;
  }
  s.step = 'upkeep';
  s.priority = s.active;
  s.passes = 0;
  s.combat = { attackers: [], blocks: {}, blocked: [], firstEligible: [], hasFirst: false };
  s.players[s.active].landsPlayed = 0;
  for (const o of controlled(s, s.active)) if (!skipsUntap(s, o)) untapObject(s, o);
  emit(s, 'turn', { player: s.active });
  notifyTriggers(s, 'step', { player: s.active, step: 'upkeep' });
}
export function finishCleanup(s) {
  for (const o of Object.values(s.objects)) {
    o.damage = 0;
    delete o.saddledTurn;
    delete o.saddleHistory;
    if (
      o.playPermission &&
      (o.playPermission.untilNextTurn === undefined || o.playPermission.nextTurnStarted)
    )
      delete o.playPermission;
    o.deathtouchDamage = false;
  }
  delete s.damagePreventionDisabledTurn;
  s.modifiers = s.modifiers.filter((m) => m.expires !== s.turn);
  const before = s.events.length;
  stabilize(s);
  if (s.status === 'finished') return;
  if (s.choice || s.stack.length || s.events.length !== before) {
    s.priority = s.active;
    s.passes = 0;
    return;
  }
  nextTurn(s);
}
export function cleanup(s) {
  s.step = 'cleanup';
  clearMana(s);
  const excess = s.players[s.active].hand.length - 7;
  if (excess > 0) {
    s.choice = { kind: 'discard', player: s.active, count: excess };
    return;
  }
  finishCleanup(s);
}
export function advanceStep(s) {
  clearMana(s);
  s.passes = 0;
  if (s.step === 'cleanup') {
    cleanup(s);
    return;
  }
  if (s.step === 'endCombat')
    s.combat = { attackers: [], blocks: {}, blocked: [], firstEligible: [], hasFirst: false };
  let index = STEPS.indexOf(s.step) + 1;
  if (s.step === 'attackers' && !s.combat.attackers.length) index = STEPS.indexOf('endCombat');
  if (s.step === 'blockers') {
    const first = combatants(s).some(
      (o) => o && ['first strike', 'double strike'].some((k) => hasKeyword(s, o, k)),
    );
    if (!first) index = STEPS.indexOf('damage');
  }
  // In a two-player game the starting player skips the whole first draw step,
  // including priority and beginning-of-draw-step triggers. Historical replays
  // retain the old step sequence through rules revision 2.
  if (
    (s.rulesRevision ?? 3) >= 3 &&
    s.turn === 1 &&
    s.active === s.startingPlayer &&
    STEPS[index] === 'draw'
  )
    index = STEPS.indexOf('main1');
  s.step = STEPS[index];
  s.priority = s.active;
  emit(s, 'step', { step: s.step, player: s.active });
  const enteredStep = s.step;
  switch (s.step) {
    case 'main1':
      for (const object of controlled(s, s.active))
        if (sagaFinalChapter(s, object)) addLoreCounters(s, object);
      break;
    case 'draw':
      if (!(s.turn === 1 && s.active === s.startingPlayer)) draw(s, s.active, 1);
      break;
    case 'attackers':
      s.choice = { kind: 'attackers', player: s.active };
      break;
    case 'blockers':
      s.choice = { kind: 'blockers', player: opponent(s.active) };
      break;
    case 'firstDamage':
      beginDamage(s, true);
      break;
    case 'damage':
      beginDamage(s, false);
      break;
    case 'endCombat':
      break;
    case 'cleanup':
      cleanup(s);
      break;
  }
  if (s.step === enteredStep) notifyTriggers(s, 'step', { player: s.active, step: enteredStep });
}

/** CR 723: discard waiting triggers, exile the stack, remove combat, then SBA and cleanup. */
export function endTurn(s, entry) {
  s.pendingTriggers = [];
  const entries = [...s.stack, entry];
  s.stack = [];
  s.resolving = null;
  for (const item of entries) {
    const object = s.objects[item.source?.id];
    if (
      item.kind === 'spell' &&
      object?.zone === 'stack' &&
      object.incarnation === item.source.incarnation
    )
      move(s, object, 'exile');
  }
  s.combat = { attackers: [], blocks: {}, blocked: [], firstEligible: [], hasFirst: false };
  s.endingTurn = true;
  emit(s, 'resolved', { name: entry.name, stackId: entry.id });
  emit(s, 'turnEnded', { player: s.active });
  finishEndingTurn(s);
}
export function finishEndingTurn(s) {
  if (!s.endingTurn || s.choice) return;
  let iterations = 0;
  while (s.status === 'playing' && !s.choice && stateBasedActions(s)) {
    if (++iterations > 100) throw new Error('End-turn state-based actions did not converge.');
    if (flushLinkedReturns(s) === false) return;
  }
  if (s.choice || flushLinkedReturns(s) === false) return;
  delete s.endingTurn;
  if (s.status === 'playing') cleanup(s);
}
