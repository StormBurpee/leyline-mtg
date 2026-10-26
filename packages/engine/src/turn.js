import {
  notifyTriggers,
  controlled,
  draw,
  emit,
  emptyMana,
  hasKeyword,
  opponent,
  STEPS,
} from './model.js';
import { beginDamage, combatants } from './combat.js';
import { stabilize, stateBasedActions } from './effects.js';
export function clearMana(s) {
  for (const p of s.players) p.mana = emptyMana();
}
export function nextTurn(s) {
  s.active = opponent(s.active);
  s.turn++;
  s.step = 'upkeep';
  s.priority = s.active;
  s.passes = 0;
  s.combat = { attackers: [], blocks: {}, blocked: [], firstEligible: [], hasFirst: false };
  s.players[s.active].landsPlayed = 0;
  for (const o of controlled(s, s.active)) o.tapped = false;
  emit(s, 'turn', { player: s.active });
  notifyTriggers(s, 'step', { player: s.active, step: 'upkeep' });
}
export function finishCleanup(s) {
  for (const o of Object.values(s.objects)) {
    o.damage = 0;
    o.deathtouchDamage = false;
  }
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
  let index = STEPS.indexOf(s.step) + 1;
  if (s.step === 'attackers' && !s.combat.attackers.length) index = STEPS.indexOf('endCombat');
  if (s.step === 'blockers') {
    const first = combatants(s).some(
      (o) => o && ['first strike', 'double strike'].some((k) => hasKeyword(s, o, k)),
    );
    if (!first) index = STEPS.indexOf('damage');
  }
  s.step = STEPS[index];
  s.priority = s.active;
  emit(s, 'step', { step: s.step, player: s.active });
  const enteredStep = s.step;
  switch (s.step) {
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
      s.combat = { attackers: [], blocks: {}, blocked: [], firstEligible: [], hasFirst: false };
      break;
    case 'cleanup':
      cleanup(s);
      break;
  }
  if (s.step === enteredStep) notifyTriggers(s, 'step', { player: s.active, step: enteredStep });
}
