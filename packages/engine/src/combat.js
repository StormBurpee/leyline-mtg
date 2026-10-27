import { meetsCondition } from './conditions.js';
import { tapObjects } from './model.js';
import { manaValue } from './mana-value.js';
import { hasType } from './types.js';
import {
  maximumBlockers,
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
import { dealDamageBatch } from './effects.js';
// Intrinsic restrictions use current controller/state only at declaration time.
// Already-declared attacks/blocks are not undone when their condition changes.
function conditionalRestriction(s, object, restriction) {
  return definition(s, object).conditionalCombatRestrictions?.some(
    (rule) =>
      rule.restriction === restriction &&
      meetsCondition(s, object.controller, rule.condition, [], object),
  );
}
export function canAttack(s, o, p) {
  return (
    o.zone === 'battlefield' &&
    o.controller === p &&
    definition(s, o).type === 'creature' &&
    !o.tapped &&
    !isSick(s, o) &&
    !isPacified(s, o) &&
    !definition(s, o).cannotAttack &&
    !conditionalRestriction(s, o, 'cannotAttack') &&
    !hasKeyword(s, o, 'defender')
  );
}
// CR 509.1b, 509.1h: these change declaration legality, not abilities or
// copy values. Never recheck them to undo a block already declared.
function hasCombatRestriction(s, object, restriction) {
  return s.modifiers.some(
    (m) =>
      m.objectId === object.id &&
      m.incarnation === object.incarnation &&
      m.expires === s.turn &&
      m.combatRestriction === restriction,
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
    !definition(s, blocker).cannotBlock &&
    !conditionalRestriction(s, blocker, 'cannotBlock') &&
    !definition(s, attacker).unblockable &&
    !conditionalRestriction(s, attacker, 'unblockable') &&
    !hasCombatRestriction(s, blocker, 'cannotBlock') &&
    !hasCombatRestriction(s, attacker, 'cannotBeBlocked') &&
    (!definition(s, attacker).cannotBeBlockedByLowerPower ||
      stats(s, blocker).power >= stats(s, attacker).power) &&
    !isPacified(s, blocker) &&
    (!hasKeyword(s, attacker, 'flying') ||
      hasKeyword(s, blocker, 'flying') ||
      hasKeyword(s, blocker, 'reach'))
  );
}
/** Defenders are declared without targeting: hexproof/shroud do not restrict attacks. */
export function attackDefenders(s, player = s.active) {
  return [
    { kind: 'player', id: opponent(player) },
    ...Object.values(s.objects)
      .filter(
        (o) =>
          o.zone === 'battlefield' &&
          o.controller === opponent(player) &&
          hasType(definition(s, o), 'planeswalker'),
      )
      .map(ref),
  ];
}
export function attackDefender(s, attacker) {
  const selected = s.combat.defenders?.[attacker] ?? { kind: 'player', id: opponent(s.active) };
  if (selected.kind === 'player') return selected.id === opponent(s.active) ? selected : null;
  const object = s.objects[selected.id];
  return object?.zone === 'battlefield' &&
    object.incarnation === selected.incarnation &&
    object.controller === opponent(s.active) &&
    hasType(definition(s, object), 'planeswalker')
    ? selected
    : null;
}
export function validateAttackDefenders(s, ids, defenders = {}) {
  requireRule(
    defenders &&
      typeof defenders === 'object' &&
      !Array.isArray(defenders) &&
      Object.keys(defenders).every((id) => ids.includes(id)),
    'DEFENDERS',
    'Choose defenders only for selected attackers.',
  );
  const legal = attackDefenders(s);
  for (const target of Object.values(defenders))
    requireRule(
      target &&
        legal.some(
          (t) =>
            t.kind === target.kind &&
            t.id === target.id &&
            (t.kind === 'player' || t.incarnation === target.incarnation),
        ),
      'DEFENDER',
      'Choose the defending player or one of their current planeswalkers.',
    );
}
export function declareAttackers(s, ids, defenders = {}) {
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
  validateAttackDefenders(s, ids, defenders);
  s.combat = {
    ...(Object.keys(defenders).length ? { defenders: structuredClone(defenders) } : {}),
    attackers: ids.map((id) => ref(s.objects[id])),
    blocks: {},
    blocked: [],
    firstEligible: [],
    hasFirst: false,
  };
  tapObjects(
    s,
    ids.map((id) => s.objects[id]).filter((o) => !hasKeyword(s, o, 'vigilance')),
  );
  s.choice = null;
  s.priority = s.active;
  s.passes = 0;
  emit(s, 'attackers', {
    player: s.active,
    ids,
    ...(Object.keys(defenders).length ? { defenders: structuredClone(defenders) } : {}),
  });
  // CR 508.1m: only declared attackers trigger. Resolve nothing during declaration.
  for (const id of ids) notifyTriggers(s, 'attack', { object: s.objects[id] });
  if (ids.length)
    notifyTriggers(s, 'attackGroup', {
      player: s.active,
      objects: ids.map((id) => {
        const object = s.objects[id];
        const card = definition(s, object);
        // Capture the declared attacker's current public characteristics, not just its
        // printed definition. Group filters use these same facts as individual events.
        return {
          id,
          incarnation: object.incarnation,
          definition: card,
          controller: object.controller,
          owner: object.owner,
          token: object.token,
          tapped: object.tapped,
          attacking: true,
          blocking: false,
          stunCounters: object.stunCounters,
          manaValue: manaValue(card),
          keywords: keywords(s, object),
          ...stats(s, object),
        };
      }),
    });
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
      count <= maximumBlockers(s, s.objects[attack.id]),
      'MAX_BLOCKERS',
      'That attacker cannot be blocked by this many creatures.',
    );
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
    // A returned/reentered ninja is a new object, even when its stable UI ID is reused.
    // Preserve historical replay behavior for the legacy rules engine.
    if (s.rulesRevision !== 1)
      s.combat.firstIncarnations = Object.fromEntries(cs.map((o) => [o.id, o.incarnation]));
  }
  const dealtFirst = (o) =>
    s.combat.firstEligible.includes(o.id) &&
    (!s.combat.firstIncarnations || s.combat.firstIncarnations[o.id] === o.incarnation);
  const eligible = (o) =>
    s.step === 'firstDamage'
      ? dealtFirst(o)
      : !s.combat.hasFirst || !dealtFirst(o) || hasKeyword(s, o, 'double strike');
  const sources = [];
  for (const ar of s.combat.attackers) {
    const a = alive(s, ar);
    if (!a || !eligible(a) || stats(s, a).power <= 0) continue;
    const blockers = (s.combat.blocks[a.id] ?? []).map((r) => alive(s, r)).filter(Boolean);
    const blocked = s.combat.blocked.includes(a.id),
      trample = hasKeyword(s, a, 'trample');
    if (blocked && !blockers.length && !trample) continue;
    const defender = attackDefender(s, a.id);
    if (!blockers.length && !defender) continue;
    sources.push({
      source: ref(a),
      controller: a.controller,
      power: Math.max(0, stats(s, a).power),
      targets: [...blockers.map(ref), ...((!blocked || trample) && defender ? [defender] : [])],
      trample,
      ...(defender ? { defender } : {}),
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
      if (
        target.kind === 'object' &&
        source.blockers.some((b) => sameTarget(b, target)) &&
        source.targets.length > 1
      ) {
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
            incarnation: source.source.incarnation,
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
    const defenderDamage = order.assignments.some(
      (x) =>
        x.amount > 0 &&
        (source.defender ? sameTarget(x.target, source.defender) : x.target.kind === 'player'),
    );
    if (source.trample && defenderDamage)
      for (const blocker of source.blockers) {
        const o = s.objects[blocker.id],
          amount = order.assignments.find((x) => sameTarget(x.target, blocker))?.amount ?? 0;
        requireRule(
          amount + o.damage >= stats(s, o).toughness ||
            (amount > 0 && source.keywords.includes('deathtouch')),
          'TRAMPLE',
          'Assign lethal damage to every blocker before assigning trample damage to the defender.',
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
  dealDamageBatch(s, c.packets, true);
  s.choice = null;
  s.priority = s.active;
  s.passes = 0;
  emit(s, 'combatDamage', { packets: c.packets.length });
}
