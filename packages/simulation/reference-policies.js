import { chooseBotCommand as released } from '../../tests/fixtures/v0.22-policy/bot.js';

/** Explicit compatibility adapter; the frozen v0.22 source is unchanged.
 * Its combat forecast crashes on departed attackers. Remove only stale public
 * attacker references before invoking it, so evaluation can finish those games.
 * This is a separately identified opponent, never silently substituted for v0.22.
 */
export function chooseReleasedSafe(observation, player) {
  const attackers = observation.combat.attackers.filter(
    (r) =>
      observation.objects[r.id]?.zone === 'battlefield' &&
      observation.objects[r.id].incarnation === r.incarnation,
  );
  const view =
    attackers.length === observation.combat.attackers.length
      ? observation
      : {
          ...observation,
          combat: { ...observation.combat, attackers },
        };
  return released(view, player);
}
