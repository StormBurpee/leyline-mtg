import { legalActions, suggestedDamage } from '../../packages/engine/src/index.js';

// Presentation policy, not a rules shortcut: every yield still dispatches a pass.
export const stopKey = (s, player, step = s.step) =>
  `${s.active === player ? 'you' : 'opponent'}:${step}`;
export function hasStop(s, player, ui) {
  return !!ui.stops?.[stopKey(s, player)];
}
export function autoCommand(s, player, ui) {
  if (
    !s ||
    s.status === 'finished' ||
    (s.choice?.player ?? s.priority) !== player ||
    ui.targeting ||
    ui.selected ||
    ui.controlMode === 'full' ||
    hasStop(s, player, ui)
  )
    return null;
  if (s.choice) {
    if (s.choice.kind === 'orderTriggers' && ui.autoOrderTriggers)
      return { type: 'orderTriggers', ids: s.choice.entries.map((e) => e.id) };
    if (s.choice.kind === 'assignDamage' && ui.autoDamage)
      return { type: 'assignDamage', orders: suggestedDamage(s) };
    return null; // Targets, optional effects, discards, attacks and blocks remain decisions.
  }
  if (ui.yieldMode && ui.yieldTurn === s.turn) return { type: 'pass' };
  if (!ui.autoYield) return null;
  const actions = legalActions(s, player),
    useful = actions.some((a) => ['cast', 'activate', 'cycle', 'playLand'].includes(a.type));
  if (s.stack.length) {
    if (s.stack.at(-1).controller === player) return ui.holdPriority ? null : { type: 'pass' };
    return useful ? null : { type: 'pass' };
  }
  if (s.active === player && ['main1', 'main2'].includes(s.step)) return null;
  // Retain floating mana windows and actual combat decisions. Own low-activity
  // upkeep/draw/end steps are skipped unless a stop or full control was requested.
  if (
    s.active === player &&
    ['upkeep', 'draw', 'end'].includes(s.step) &&
    !Object.values(s.players[player].mana).some(Boolean)
  )
    return { type: 'pass' };
  return useful ? null : { type: 'pass' };
}
export function updateYield(previous, next, player, ui) {
  if (!ui.yieldMode) return;
  if (next.turn !== ui.yieldTurn || next.status === 'finished') {
    ui.yieldMode = null;
    return;
  }
  if (ui.yieldMode === 'response') {
    const known = new Set(previous.stack.map((e) => e.id));
    if (next.stack.some((e) => e.controller !== player && !known.has(e.id))) ui.yieldMode = null;
  }
}
export function advanceLabel(s, player) {
  if (s.stack.length)
    return s.stack.at(-1).controller === player ? 'Resolve' : 'Resolve opponent’s effect';
  if (s.active !== player) return 'Pass';
  return (
    {
      upkeep: 'To draw',
      draw: 'To main',
      main1: 'To combat',
      beginCombat: 'To attackers',
      attackers: 'To blockers',
      blockers: 'To damage',
      firstDamage: 'Continue combat',
      damage: 'Continue combat',
      endCombat: 'To main',
      main2: 'End turn',
      end: 'Finish turn',
      cleanup: 'Continue',
    }[s.step] ?? 'Continue'
  );
}
