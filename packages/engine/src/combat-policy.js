import { beginDamage, assignDamage, canBlock, canAttack } from './combat.js';
import { stateBasedActions, stabilize, resolveTop, finishTriggerOrder } from './effects.js';
import { settleCombatPayoffs } from './combat-payoffs.js';
import {
  notifyTriggers,
  definition,
  stats,
  keywords,
  hasKeyword,
  isPacified,
  ref,
  emptyMana,
} from './model.js';

/** Bounded, public-board combat search. No hands, library order, seed or RNG are read.
 * Damage and life-only death payoffs use the actual rules. Future draws, combat
 * tricks and other triggered effects remain outside this tactical horizon.
 */
export function permanentValue(s, o) {
  const d = definition(s, o),
    pt = stats(s, o);
  return d.type === 'creature'
    ? Math.max(0, pt.power) * 1.35 +
        Math.max(0, pt.toughness) * 0.8 +
        keywords(s, o).length * 0.8 +
        (d.triggers?.length ?? 0) * 1.8 +
        (d.activated?.length ?? 0) * 1.2
    : Object.values(d.cost).reduce((a, b) => a + b, 0) + 1;
}
function boardCopy(s, active, pairs, attackerIds) {
  const objects = Object.fromEntries(
    Object.values(s.objects)
      .filter((o) => o.zone === 'battlefield')
      .map((o) => [o.id, structuredClone(o)]),
  );
  const names = new Set(Object.values(objects).map((o) => o.name));
  const blocks = {};
  for (const { blocker, attacker } of pairs) (blocks[attacker] ??= []).push(ref(objects[blocker]));
  return {
    status: 'playing',
    winner: null,
    turn: s.turn,
    step: 'blockers',
    active,
    priority: active,
    passes: 0,
    objects,
    catalog: Object.fromEntries([...names].map((name) => [name, s.catalog[name]])),
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      life: p.life,
      mana: emptyMana(),
      library: [],
      hand: [],
      graveyard: [],
      exile: [],
      failedDraw: false,
    })),
    modifiers: structuredClone((s.modifiers ?? []).filter((m) => objects[m.objectId])),
    stack: [],
    pendingTriggers: [],
    resolving: null,
    choice: null,
    events: [],
    eventSeq: 0,
    nextId: 0,
    combat: {
      attackers: attackerIds.map((id) => ref(objects[id])),
      blocks,
      blocked: Object.keys(blocks),
      firstEligible: [],
      hasFirst: false,
    },
  };
}
/** Allocate lethal damage to valuable blockers instead of respecting an arbitrary
 * declaration order. This is a deterministic adversarial response, not an oracle.
 */
export function tacticalDamage(s, choice = s.choice) {
  return choice.sources.map((source) => {
    const creatures = source.targets.filter((t) => t.kind === 'object'),
      player = source.targets.find((t) => t.kind === 'player');
    if (creatures.length <= 1) {
      let left = source.power;
      const assignments = source.targets.map((target, index) => {
        const o = s.objects[target.id];
        let amount = left;
        if (o && source.targets.length > 1)
          amount = Math.min(
            left,
            source.keywords.includes('deathtouch')
              ? 1
              : Math.max(0, stats(s, o).toughness - o.damage),
          );
        left -= amount;
        return { target, amount };
      });
      if (left && assignments.length) assignments.at(-1).amount += left;
      return { source: source.source.id, assignments };
    }
    const costs = creatures.map((t) =>
      source.keywords.includes('deathtouch')
        ? 1
        : Math.max(0, stats(s, s.objects[t.id]).toughness - s.objects[t.id].damage),
    );
    const n = Math.min(creatures.length, 12),
      limit = 1 << n;
    let best = null;
    for (let mask = 0; mask < limit; mask++) {
      let spent = 0,
        score = 0;
      const amounts = creatures.map(() => 0);
      for (let i = 0; i < n; i++)
        if (mask & (1 << i)) {
          spent += costs[i];
          amounts[i] = costs[i];
          const o = s.objects[creatures[i].id];
          if (!hasKeyword(s, o, 'indestructible'))
            score +=
              permanentValue(s, o) +
              (s.step === 'firstDamage' &&
              !hasKeyword(s, o, 'first strike') &&
              !hasKeyword(s, o, 'double strike')
                ? Math.max(0, stats(s, o).power) * 1.2 + (hasKeyword(s, o, 'deathtouch') ? 5 : 0)
                : 0);
        }
      if (spent > source.power) continue;
      const all = creatures.every((_, i) => amounts[i] >= costs[i]);
      const face = player && all ? source.power - spent : 0;
      score += face * 1.5 + (player && face >= s.players[player.id].life ? 10000 : 0);
      if (!best || score > best.score) best = { amounts, face, spent, score };
    }
    let left = source.power - best.spent - best.face;
    if (left) {
      const i = creatures.findIndex((_, i) => best.amounts[i] < costs[i]);
      best.amounts[i < 0 ? 0 : i] += left;
    }
    return {
      source: source.source.id,
      assignments: [
        ...creatures.map((target, i) => ({ target, amount: best.amounts[i] })),
        ...(player ? [{ target: player, amount: best.face }] : []),
      ],
    };
  });
}
export function combatOutcome(
  s,
  pairs,
  { active = s.active, attackers = s.combat.attackers.map((r) => r.id), blocked = null } = {},
) {
  const work = boardCopy(s, active, pairs, attackers);
  if (blocked) work.combat.blocked = [...blocked];
  const first = [...attackers, ...pairs.map((p) => p.blocker)].some(
    (id) =>
      hasKeyword(work, work.objects[id], 'first strike') ||
      hasKeyword(work, work.objects[id], 'double strike'),
  );
  let omittedTriggers = 0,
    payoffLimitReached = false;
  for (const phase of first ? ['firstDamage', 'damage'] : ['damage']) {
    if (work.status === 'finished') break;
    work.step = phase;
    beginDamage(work, phase === 'firstDamage');
    while (work.choice?.kind === 'assignDamage') assignDamage(work, tacticalDamage(work));
    for (let i = 0; i < 16 && work.status !== 'finished' && stateBasedActions(work); i++);
    if (work.status !== 'finished') {
      const payoffs = settleCombatPayoffs(work);
      omittedTriggers += payoffs.omitted;
      payoffLimitReached ||= payoffs.limited;
      if (payoffs.limited) break;
    }
  }
  const values = [0, 0];
  for (const o of Object.values(work.objects))
    if (o.zone === 'battlefield') values[o.controller] += permanentValue(work, o);
  return {
    life: work.players.map((p) => p.life),
    omittedTriggers,
    payoffLimitReached,
    values,
    alive: Object.values(work.objects)
      .filter((o) => o.zone === 'battlefield')
      .map((o) => o.id),
    winner: work.winner,
    status: work.status,
  };
}
function utility(result, p) {
  const life = result.life[p],
    other = result.life[1 - p];
  return (
    (life <= 0 ? -1_000_000 : 0) +
    (other <= 0 ? 1_000_000 : 0) +
    result.values[p] * 2 -
    result.values[1 - p] * 2 +
    Math.min(30, life) * 2.3 -
    Math.min(30, other) * 1.5 +
    (life > 0 && life <= 4 ? -18 : 0)
  );
}
function legalGroups(s, pairs) {
  return s.combat.attackers.every(
    (a) =>
      !hasKeyword(s, s.objects[a.id], 'menace') ||
      pairs.filter((p) => p.attacker === a.id).length !== 1,
  );
}
export function chooseBlocks(s, p, { budget = 1400 } = {}) {
  const attackers = s.combat.attackers
    .map((r) => s.objects[r.id])
    .filter((o) => o?.zone === 'battlefield');
  const blockers = Object.values(s.objects).filter(
    (o) =>
      o.zone === 'battlefield' &&
      o.controller === p &&
      definition(s, o).type === 'creature' &&
      !o.tapped,
  );
  const evaluate = (pairs) => {
    const outcome = combatOutcome(s, pairs);
    return { pairs, outcome, score: utility(outcome, p) };
  };
  let best = evaluate([]),
    count = 1;
  for (const attacker of attackers) {
    const all = blockers
      .filter((b) => canBlock(s, b, attacker, p))
      .map((b) => ({ blocker: b.id, attacker: attacker.id }));
    if (all.length && (!hasKeyword(s, attacker, 'menace') || all.length >= 2)) {
      const trial = evaluate(all);
      count++;
      if (trial.score > best.score) best = trial;
    }
  }
  if (attackers.length === 1 && blockers.length <= 12) {
    const a = attackers[0],
      eligible = blockers.filter((b) => canBlock(s, b, a, p));
    const groups = Array.from({ length: 1 << eligible.length }, (_, mask) =>
      eligible.filter((_, i) => mask & (1 << i)).map((b) => ({ blocker: b.id, attacker: a.id })),
    ).filter((g) => !hasKeyword(s, a, 'menace') || g.length !== 1);
    // Prioritize varied group sizes if an unusually wide board exhausts the budget.
    groups.sort((a, b) => a.length - b.length);
    for (const pairs of groups) {
      if (count++ >= budget) break;
      const trial = evaluate(pairs);
      if (trial.score > best.score) best = trial;
    }
  } else {
    let beam = [evaluate([])];
    for (const blocker of blockers) {
      const next = [];
      for (const node of beam) {
        next.push(node);
        for (const a of attackers.filter((a) => canBlock(s, blocker, a, p))) {
          if (count++ >= budget) break;
          const pairs = [...node.pairs, { blocker: blocker.id, attacker: a.id }];
          const complete = legalGroups(s, pairs);
          const partial = pairs.filter(
            (pair) =>
              !hasKeyword(s, s.objects[pair.attacker], 'menace') ||
              pairs.filter((x) => x.attacker === pair.attacker).length >= 2,
          );
          const trial = evaluate(complete ? pairs : partial);
          trial.pairs = pairs;
          if (complete && trial.score > best.score) best = trial;
          next.push(trial);
        }
      }
      beam = next.sort((a, b) => b.score - a.score).slice(0, 48);
      if (count >= budget) break;
    }
  }
  return { ...best, examined: count };
}
export function preserveForDefense(s, source, p) {
  if (definition(s, source).type !== 'creature' || source.tapped) return false;
  if (
    s.active !== p &&
    ['firstDamage', 'damage', 'endCombat', 'main2', 'end', 'cleanup'].includes(s.step)
  )
    return false;
  const enemy = 1 - p;
  const attackers =
    s.active === enemy && s.combat.attackers.length
      ? s.combat.attackers.map((r) => r.id)
      : Object.values(s.objects)
          .filter(
            (o) =>
              o.zone === 'battlefield' &&
              o.controller === enemy &&
              definition(s, o).type === 'creature' &&
              !hasKeyword(s, o, 'defender') &&
              !isPacified(s, o) &&
              (s.active === p || canAttack(s, o, enemy)),
          )
          .map((o) => o.id);
  if (!attackers.length) return false;
  // Project only public attackers. The enemy's next untap is known; draws are not.
  const projected =
    s.active === p
      ? {
          ...s,
          modifiers: (s.modifiers ?? []).filter((m) => m.expires !== s.turn),
          objects: Object.fromEntries(
            Object.entries(s.objects).map(([id, o]) => [
              id,
              o.zone === 'battlefield' ? { ...o, damage: 0, deathtouchDamage: false } : o,
            ]),
          ),
        }
      : s;
  const view = {
    ...projected,
    active: enemy,
    combat: { ...s.combat, attackers: attackers.map((id) => ref(s.objects[id])) },
  };
  const held = chooseBlocks(view, p, { budget: 180 });
  const tapped = {
    ...view,
    objects: { ...view.objects, [source.id]: { ...view.objects[source.id], tapped: true } },
  };
  const spent = chooseBlocks(tapped, p, { budget: 180 });
  return (held.outcome.life[p] > 0 && spent.outcome.life[p] <= 0) || held.score > spent.score + 3;
}
/** Compare bounded attack subsets against a defending response and a public-board
 * crack-back check. No unknown combat tricks or future draws are invented. */
/** Only mandatory untargeted public-board attack effects are forecast. Whole
 * mixed/draw/search/targeted abilities are omitted; this never reads a library. */
function projectAttackDeclaration(s, p, ids) {
  const work = boardCopy(s, p, [], ids);
  work.step = 'attackers';
  for (const id of ids) {
    if (!hasKeyword(work, work.objects[id], 'vigilance')) work.objects[id].tapped = true;
  }
  for (const id of ids) notifyTriggers(work, 'attack', { object: work.objects[id] });
  work.pendingTriggers = work.pendingTriggers.filter(
    (entry) =>
      !entry.optional &&
      !entry.targetKind &&
      entry.effects.every(
        (e) =>
          ['gainLife', 'loseLife', 'damageOpponent'].includes(e.op) ||
          (e.op === 'modify' && e.subject === 'source' && e.power >= 0 && e.toughness >= 0),
      ),
  );
  for (let i = 0; i < 512 && work.status !== 'finished'; i++) {
    if (!work.choice) stabilize(work);
    if (work.status === 'finished') break;
    if (work.choice?.kind === 'orderTriggers')
      finishTriggerOrder(
        work,
        work.choice.entries.map((e) => e.id),
      );
    else if (work.choice) break;
    else if (work.stack.length) resolveTop(work);
    else break;
  }
  return work;
}
export function chooseAttacks(s, p) {
  const eligible = Object.values(s.objects).filter((o) => canAttack(s, o, p));
  if (!eligible.length) return [];
  const sets = [[], eligible.map((o) => o.id)];
  if (eligible.length <= 5)
    for (let mask = 1; mask < (1 << eligible.length) - 1; mask++)
      sets.push(eligible.filter((_, i) => mask & (1 << i)).map((o) => o.id));
  else {
    for (const o of eligible.slice(0, 12)) {
      sets.push([o.id]);
      sets.push(eligible.filter((x) => x.id !== o.id).map((x) => x.id));
    }
    const byPower = [...eligible].sort((a, b) => stats(s, b).power - stats(s, a).power);
    for (const count of [2, 3, 4]) sets.push(byPower.slice(0, count).map((o) => o.id));
  }
  let best = { cards: [], score: -Infinity };
  for (const cards of sets) {
    let scenario = {
      ...s,
      active: p,
      combat: {
        attackers: cards.map((id) => ref(s.objects[id])),
        blocks: {},
        blocked: [],
        firstEligible: [],
        hasFirst: false,
      },
    };
    const hasAttackTriggers = Object.values(s.objects).some(
      (o) =>
        o.zone === 'battlefield' &&
        (definition(s, o).triggers ?? []).some(
          (t) => t.event === 'selfAttacks' || t.event?.event === 'attack',
        ),
    );
    if (hasAttackTriggers) scenario = projectAttackDeclaration(scenario, p, cards);
    const result =
      scenario.status === 'finished'
        ? {
            life: scenario.players.map((player) => player.life),
            values: [0, 1].map((player) =>
              Object.values(scenario.objects)
                .filter((o) => o.zone === 'battlefield' && o.controller === player)
                .reduce((sum, o) => sum + permanentValue(scenario, o), 0),
            ),
            alive: Object.values(scenario.objects)
              .filter((o) => o.zone === 'battlefield')
              .map((o) => o.id),
          }
        : chooseBlocks(scenario, 1 - p, { budget: 96 }).outcome;
    let score = utility(result, p);
    if (result.life[p] > 0 && result.life[1 - p] > 0) {
      const alive = new Set(result.alive);
      const objects = Object.fromEntries(
        Object.values(s.objects)
          .filter((o) => alive.has(o.id))
          .map((o) => [
            o.id,
            {
              ...o,
              damage: 0,
              deathtouchDamage: false,
              tapped:
                o.controller === 1 - p
                  ? false
                  : cards.includes(o.id) && !hasKeyword(s, o, 'vigilance')
                    ? true
                    : o.tapped,
            },
          ]),
      );
      const reply = {
        ...s,
        objects,
        active: 1 - p,
        turn: s.turn + 1,
        players: s.players.map((player, i) => ({ ...player, life: result.life[i] })),
        modifiers: (s.modifiers ?? []).filter((m) => m.expires !== s.turn),
      };
      const incoming = Object.values(objects).filter(
        (o) =>
          o.controller === 1 - p &&
          definition(s, o).type === 'creature' &&
          !hasKeyword(s, o, 'defender') &&
          !isPacified(s, o),
      );
      reply.combat = {
        attackers: incoming.map(ref),
        blocks: {},
        blocked: [],
        firstEligible: [],
        hasFirst: false,
      };
      const defense = chooseBlocks(reply, p, { budget: 64 }).outcome;
      if (defense.life[p] <= 0) score -= 100_000;
      else if (defense.life[p] <= 4) score -= 12;
    }
    if (score > best.score) {
      best = { cards, score };
    }
  }
  return best.cards;
}
