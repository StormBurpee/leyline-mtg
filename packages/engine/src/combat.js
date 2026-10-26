import {
  notifyTriggers,
  controlled,
  creatures,
  definition,
  emit,
  hasKeyword,
  isPacified,
  isSick,
  keywords,
  opponent,
  ref,
  requireRule,
  stats,
} from './model.js';
import { dealDamage } from './effects.js';
export function canAttack(s, o, p) {
  return (
    o.zone === 'battlefield' &&
    o.controller === p &&
    definition(s, o).type === 'creature' &&
    !o.tapped &&
    !isSick(s, o) &&
    !isPacified(s, o) &&
    !hasKeyword(s, o, 'defender')
  );
}
export function canBlock(s, blocker, attacker, p) {
  return (
    blocker?.zone === 'battlefield' &&
    attacker?.zone === 'battlefield' &&
    blocker.controller === p &&
    attacker.controller !== p &&
    definition(s, attacker).type === 'creature' &&
    definition(s, blocker).type === 'creature' &&
    !blocker.tapped &&
    !isPacified(s, blocker) &&
    (!hasKeyword(s, attacker, 'flying') ||
      hasKeyword(s, blocker, 'flying') ||
      hasKeyword(s, blocker, 'reach'))
  );
}
export function declareAttackers(s, ids) {
  requireRule(
    Array.isArray(ids) && new Set(ids).size === ids.length,
    'ATTACKERS',
    'Select distinct attackers.',
  );
  for (const id of ids)
    requireRule(
      s.objects[id] && canAttack(s, s.objects[id], s.active),
      'ATTACKER',
      `${s.objects[id]?.name ?? id} cannot attack.`,
    );
  s.combat = {
    attackers: ids.map((id) => ref(s.objects[id])),
    blocks: {},
    blocked: [],
    firstEligible: [],
    hasFirst: false,
  };
  for (const id of ids) if (!hasKeyword(s, s.objects[id], 'vigilance')) s.objects[id].tapped = true;
  s.choice = null;
  s.priority = s.active;
  s.passes = 0;
  emit(s, 'attackers', { player: s.active, ids });
  // CR 508.1m: only declared attackers trigger. Resolve nothing during declaration.
  for (const id of ids) notifyTriggers(s, 'attack', { object: s.objects[id] });
}
export function declareBlockers(s, pairs) {
  requireRule(Array.isArray(pairs), 'BLOCKERS', 'Block assignments must be an array.');
  const used = new Set();
  for (const { blocker, attacker } of pairs) {
    requireRule(
      !used.has(blocker),
      'BLOCKER_REUSED',
      'A blocker can block only one creature in this card pool.',
    );
    used.add(blocker);
    requireRule(
      s.combat.attackers.some(
        (r) => r.id === attacker && s.objects[attacker]?.incarnation === r.incarnation,
      ) && canBlock(s, s.objects[blocker], s.objects[attacker], opponent(s.active)),
      'BLOCKER',
      'That block is not legal.',
    );
  }
  for (const attack of s.combat.attackers) {
    const count = pairs.filter((pair) => pair.attacker === attack.id).length;
    requireRule(
      count !== 1 || !hasKeyword(s, s.objects[attack.id], 'menace'),
      'MENACE',
      'A creature with menace must be blocked by at least two creatures.',
    );
  }
  s.combat.blocks = {};
  s.combat.blocked = [];
  for (const { blocker, attacker } of pairs) {
    (s.combat.blocks[attacker] ??= []).push(ref(s.objects[blocker]));
    if (!s.combat.blocked.includes(attacker)) s.combat.blocked.push(attacker);
  }
  s.choice = null;
  s.priority = s.active;
  s.passes = 0;
  emit(s, 'blockers', { player: opponent(s.active), pairs });
}
const alive = (s, r) => {
  const o = s.objects[r.id];
  return o?.zone === 'battlefield' && o.incarnation === r.incarnation ? o : null;
};
export function combatants(s) {
  return [...s.combat.attackers, ...Object.values(s.combat.blocks).flat()]
    .map((r) => alive(s, r))
    .filter(Boolean);
}
export function beginDamage(s, first) {
  if (first) {
    const cs = combatants(s);
    s.combat.firstEligible = cs
      .filter((o) => hasKeyword(s, o, 'first strike') || hasKeyword(s, o, 'double strike'))
      .map((o) => o.id);
    s.combat.hasFirst = s.combat.firstEligible.length > 0;
  }
  const eligible = (o) =>
    s.step === 'firstDamage'
      ? s.combat.firstEligible.includes(o.id)
      : !s.combat.hasFirst ||
        !s.combat.firstEligible.includes(o.id) ||
        hasKeyword(s, o, 'double strike');
  const sources = [];
  for (const ar of s.combat.attackers) {
    const a = alive(s, ar);
    if (!a || !eligible(a) || stats(s, a).power <= 0) continue;
    const blockers = (s.combat.blocks[a.id] ?? []).map((r) => alive(s, r)).filter(Boolean);
    const blocked = s.combat.blocked.includes(a.id),
      trample = hasKeyword(s, a, 'trample');
    if (blocked && !blockers.length && !trample) continue;
    sources.push({
      source: ref(a),
      controller: a.controller,
      power: Math.max(0, stats(s, a).power),
      targets: [
        ...blockers.map(ref),
        ...(!blocked || trample ? [{ kind: 'player', id: opponent(s.active) }] : []),
      ],
      trample,
      blockers: blockers.map(ref),
      keywords: keywords(s, a),
    });
  }
  for (const [attacker, brs] of Object.entries(s.combat.blocks)) {
    const ar = s.combat.attackers.find((r) => r.id === attacker),
      a = ar && alive(s, ar);
    if (!a) continue;
    for (const br of brs) {
      const b = alive(s, br);
      if (!b || !eligible(b) || stats(s, b).power <= 0) continue;
      sources.push({
        source: ref(b),
        controller: b.controller,
        power: Math.max(0, stats(s, b).power),
        targets: [ref(a)],
        trample: false,
        blockers: [],
        keywords: keywords(s, b),
      });
    }
  }
  const groups = [s.active, opponent(s.active)]
    .map((player) => ({ player, sources: sources.filter((x) => x.controller === player) }))
    .filter((g) => g.sources.length);
  if (!groups.length) {
    s.priority = s.active;
    return;
  }
  s.choice = {
    kind: 'assignDamage',
    player: groups[0].player,
    sources: groups[0].sources,
    remaining: groups.slice(1),
    packets: [],
  };
}
const sameTarget = (a, b) =>
  a.kind === b.kind && a.id === b.id && (a.kind !== 'object' || a.incarnation === b.incarnation);
/** A convenience suggestion only. The command accepts every legal distribution. */
export function suggestedDamage(s, choice = s.choice) {
  return choice.sources.map((source) => {
    let remaining = source.power;
    const assignments = [];
    for (const target of source.targets) {
      let amount = remaining;
      if (target.kind === 'object' && source.targets.length > 1) {
        const o = s.objects[target.id];
        amount = Math.min(
          remaining,
          source.keywords.includes('deathtouch')
            ? 1
            : Math.max(0, stats(s, o).toughness - o.damage),
        );
      }
      assignments.push({ target, amount });
      remaining -= amount;
    }
    if (remaining && assignments.length) assignments[assignments.length - 1].amount += remaining;
    return { source: source.source.id, assignments };
  });
}
export function assignDamage(s, orders) {
  const c = s.choice;
  requireRule(
    Array.isArray(orders) && orders.length === c.sources.length,
    'DAMAGE_ASSIGNMENT',
    'Assign damage from every eligible creature.',
  );
  const seen = new Set();
  const packets = [];
  for (const order of orders) {
    const source = c.sources.find((x) => x.source.id === order.source);
    requireRule(
      source && !seen.has(order.source),
      'DAMAGE_SOURCE',
      'Unknown or duplicate damage source.',
    );
    seen.add(order.source);
    requireRule(
      Array.isArray(order.assignments),
      'DAMAGE_ASSIGNMENT',
      'Assignments must be an array.',
    );
    let total = 0;
    const targets = new Set();
    for (const { target, amount } of order.assignments) {
      requireRule(
        source.targets.some((t) => sameTarget(t, target)),
        'DAMAGE_TARGET',
        'Illegal combat damage target.',
      );
      const key = `${target.kind}:${target.id}`;
      requireRule(!targets.has(key), 'DAMAGE_TARGET', 'Duplicate damage target.');
      targets.add(key);
      requireRule(
        Number.isSafeInteger(amount) && amount >= 0,
        'DAMAGE_AMOUNT',
        'Damage must be a nonnegative integer.',
      );
      total += amount;
      if (amount)
        packets.push({
          source: {
            id: source.source.id,
            controller: source.controller,
            keywords: source.keywords,
          },
          target,
          amount,
        });
    }
    requireRule(
      total === source.power,
      'DAMAGE_TOTAL',
      'Assign exactly the creature’s power in combat damage.',
    );
    const playerDamage = order.assignments.some((x) => x.target.kind === 'player' && x.amount > 0);
    if (source.trample && playerDamage)
      for (const blocker of source.blockers) {
        const o = s.objects[blocker.id],
          amount = order.assignments.find((x) => sameTarget(x.target, blocker))?.amount ?? 0;
        requireRule(
          amount + o.damage >= stats(s, o).toughness ||
            (amount > 0 && source.keywords.includes('deathtouch')),
          'TRAMPLE',
          'Assign lethal damage to every blocker before assigning trample damage to the player.',
        );
      }
  }
  c.packets.push(...packets);
  if (c.remaining.length) {
    const [next, ...rest] = c.remaining;
    s.choice = { ...c, player: next.player, sources: next.sources, remaining: rest };
    return;
  }
  // All sources and damage amounts were frozen before any packet was applied.
  for (const packet of c.packets) dealDamage(s, packet.source, packet.target, packet.amount);
  s.choice = null;
  s.priority = s.active;
  s.passes = 0;
  emit(s, 'combatDamage', { packets: c.packets.length });
}
