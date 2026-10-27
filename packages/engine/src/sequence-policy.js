import { flattenTargets } from './target-groups.js';
import { castingProfile } from './casting-costs.js';
import { definition } from './model.js';
import { planPayment } from './mana.js';
import { actionEffects, actionSafe, drawsFor, libraryCount } from './decision-safety.js';

export const SEQUENCE_BUDGET = 256;
const targetKey = (a) => (a.target?.kind === 'object' ? a.target.id : null);

/** Resource search, not a fabricated full-state rollout. It uses the exact auto-
 * payment plan and known effects/costs, never draws cards or simulates unknown
 * responses. Future candidates are limited to currently legal, positively scored
 * casts. Replan after every actual action/response; unsupported triggers and new
 * targets are deliberately outside this horizon. */
export function chooseSequence(s, p, ranked, { budget = SEQUENCE_BUDGET, depth = 4 } = {}) {
  if (s.stack.length || s.active !== p || !['main1', 'main2'].includes(s.step)) return null;
  // Grouped removal is scored directly and replanned after resolution, not projected as independent resource-only plays.
  const positive = ranked.filter((r) => r.score > 0 && !r.a.targets);
  const groups = new Map();
  for (const r of positive) {
    if (!groups.has(r.a.card)) groups.set(r.a.card, []);
    groups.get(r.a.card).push(r);
  }
  // Many targets for one removal spell must not crowd every other card or
  // known face-damage line out of the candidate budget.
  const candidates = positive
    .filter((r) => r.a.target?.kind === 'player' && r.a.target.id === 1 - p)
    .slice(0, 12);
  for (let i = 0; i < 3 && candidates.length < 24; i++)
    for (const alternatives of groups.values()) {
      const r = alternatives[i];
      if (r && !candidates.includes(r) && candidates.length < 24) candidates.push(r);
    }
  candidates.sort((a, b) => b.score - a.score);
  if (new Set(candidates.map((r) => r.a.card)).size < 2) return null;
  let examined = 0,
    best = { score: 0, actions: [] };
  const visit = (state, used, targets, actions, score, damage) => {
    if (examined >= budget || actions.length >= depth) return;
    for (const { a, score: base } of candidates) {
      if (examined >= budget) break;
      if (used.has(a.card) || (targetKey(a) && targets.has(targetKey(a)))) continue;
      examined++;
      const card = castingProfile(
        state,
        p,
        state.objects[a.card],
        a.mode,
        a.targets ? flattenTargets(a.targets) : a.target,
      );
      const payment = planPayment(state, p, card.cost);
      if (!payment || !actionSafe(state, p, a)) continue;
      const effects = actionEffects(state, a);
      const ward =
        a.target?.kind === 'object' &&
        state.objects[a.target.id]?.zone === 'battlefield' &&
        state.objects[a.target.id]?.controller !== p
          ? definition(state, state.objects[a.target.id]).ward
          : null;
      let projected = {
        ...state,
        objects: { ...state.objects },
        players: state.players.map((entry, i) =>
          i === p
            ? { ...entry, hand: entry.hand.filter((id) => id !== a.card), mana: payment.remaining }
            : entry,
        ),
      };
      for (const id of payment.taps)
        projected.objects[id] = { ...projected.objects[id], tapped: true };
      // Reserve ward resources as well; a spell that can pay ward must not
      // incorrectly promise the same mana to a second spell in this sequence.
      if (ward) {
        const wardPayment = planPayment(projected, p, ward.mana ?? {});
        if (!wardPayment) continue;
        for (const id of wardPayment.taps)
          projected.objects[id] = { ...projected.objects[id], tapped: true };
        projected.players[p].mana = wardPayment.remaining;
        projected.players[p].life -= ward.life ?? 0;
      }
      projected.players[p].libraryCount =
        libraryCount(state, p) - drawsFor(effects, p, a.target, p);
      let face = 0;
      for (const e of effects) {
        const recipient =
          e.player === 'opponent' ? 1 - p : e.player === 'target' ? a.target?.id : p;
        if (
          e.op === 'damageOpponent' ||
          (e.op === 'damage' && a.target?.kind === 'player' && a.target.id === 1 - p) ||
          (e.op === 'loseLife' && recipient === 1 - p)
        )
          face += e.amount;
        if (e.op === 'gainLife' && recipient === p) projected.players[p].life += e.amount;
        if (e.op === 'gainLife' && recipient === 1 - p) face -= e.amount;
        if (e.op === 'loseLife' && recipient === p) projected.players[p].life -= e.amount;
      }
      if (projected.players[p].life <= 0) continue;
      const totalDamage = damage + face;
      const nextScore = score + base;
      const line = [...actions, a];
      const objective = nextScore + (totalDamage >= s.players[1 - p].life ? 1_000_000 : 0);
      if (objective > best.score) best = { score: objective, actions: line };
      const nextTargets = new Set(targets);
      if (targetKey(a)) nextTargets.add(targetKey(a));
      // Unknown draws are not added to the hand. No projected permanent is
      // installed, so new mana, ETBs and cast synergies cannot be double counted.
      visit(projected, new Set([...used, a.card]), nextTargets, line, nextScore, totalDamage);
    }
  };
  visit(s, new Set(), new Set(), [], 0, 0);
  return { action: best.actions[0], actions: best.actions, score: best.score, examined };
}
