import { manaValue } from './mana-value.js';
import { beginDamage, assignDamage, canBlock, canAttack, attackDefenders } from './combat.js';
import { stateBasedActions, stabilize, resolveTop, finishTriggerOrder } from './effects.js';
import { settleCombatPayoffs } from './combat-payoffs.js';
import {
  maximumBlockers,
  notifyTriggers,
  definition,
  stats,
  keywords,
  hasKeyword,
  isPacified,
  ref,
  emptyMana,
} from './model.js';

const liveAttackers = (s) =>
  s.combat.attackers.filter(
    (r) => s.objects[r.id]?.zone === 'battlefield' && s.objects[r.id].incarnation === r.incarnation,
  );

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
    : manaValue(d) + 1;
}
function boardCopy(s, active, pairs, attackerIds, compact = false) {
  const objects = Object.fromEntries(
    Object.values(s.objects)
      .filter((o) => {
        if (o.zone !== 'battlefield') return false;
        const d = definition(s, o);
        // Plain mana lands cannot participate in this combat-only forecast.
        // Keep every land with a potentially relevant ability/static effect.
        return (
          !compact || d.type !== 'land' || d.triggers?.length || d.static || d.activated?.length
        );
      })
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
      ...(s.combat.defenders ? { defenders: structuredClone(s.combat.defenders) } : {}),
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
    const isDefender = (t) =>
      source.defender && t.kind === source.defender.kind && t.id === source.defender.id;
    const creatures = source.targets.filter((t) => t.kind === 'object' && !isDefender(t)),
      player = source.targets.find((t) => t.kind === 'player' || isDefender(t));
    if (creatures.length <= 1) {
      let left = source.power;
      const assignments = source.targets.map((target, index) => {
        const o = s.objects[target.id];
        let amount = left;
        if (o && !isDefender(target) && source.targets.length > 1)
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
      let spent = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) spent += costs[i];
        if (spent > source.power) break;
      }
      // Reject impossible damage allocations before expensive stat/keyword
      // valuation. Numeric mask order and tie-breaking remain unchanged.
      if (spent > source.power) continue;
      let score = 0;
      const amounts = creatures.map(() => 0);
      for (let i = 0; i < n; i++)
        if (mask & (1 << i)) {
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
      const all = creatures.every((_, i) => amounts[i] >= costs[i]);
      const face = player && all ? source.power - spent : 0;
      score +=
        face * 1.5 +
        (player?.kind === 'player' && face >= s.players[player.id].life
          ? 10000
          : player?.kind === 'object' && face >= (s.objects[player.id]?.loyalty ?? Infinity)
            ? 12
            : 0);
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
  { active = s.active, attackers = liveAttackers(s).map((r) => r.id), blocked = null } = {},
) {
  const work = boardCopy(s, active, pairs, attackers, true);
  const omitted = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && !work.objects[o.id],
  );
  const omittedIds = new Set(omitted.map((o) => o.id));
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
  for (const o of omitted) values[o.controller] += permanentValue(s, o);
  for (const o of Object.values(work.objects))
    if (o.zone === 'battlefield') values[o.controller] += permanentValue(work, o);
  return {
    life: work.players.map((p) => p.life),
    omittedTriggers,
    payoffLimitReached,
    values,
    alive: Object.values(s.objects)
      .filter((o) => omittedIds.has(o.id) || work.objects[o.id]?.zone === 'battlefield')
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
  return liveAttackers(s).every(
    (a) =>
      pairs.filter((p) => p.attacker === a.id).length <= maximumBlockers(s, s.objects[a.id]) &&
      (!hasKeyword(s, s.objects[a.id], 'menace') ||
        pairs.filter((p) => p.attacker === a.id).length !== 1),
  );
}
export function chooseBlocks(s, p, { budget = 1400 } = {}) {
  const attackers = liveAttackers(s)
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
    if (all.length && legalGroups(s, all)) {
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
    ).filter((g) => legalGroups(s, g));
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
          if (pairs.filter((pair) => pair.attacker === a.id).length > maximumBlockers(s, a))
            continue;
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
      ? liveAttackers(s).map((r) => r.id)
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
  let view = {
    ...projected,
    active: enemy,
    combat: { ...s.combat, attackers: attackers.map((id) => ref(s.objects[id])) },
  };
  // Already declared attackers carry their resolved modifiers in the public
  // board. Only hypothetical declarations should add attack payoffs again.
  if (!(s.active === enemy && s.combat.attackers.length))
    view = projectAttackDeclaration(view, enemy, attackers);
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
export function chooseAttacks(s, p, { improveOutcome } = {}) {
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
    // On wide boards, all/single/largest-power subsets miss entire evasive
    // attacks (for example two small flyers behind four stalled ground bodies).
    // Include coherent public ability groups before evaluating defender replies.
    const defenders = Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.controller !== p,
    );
    const unopposed = eligible.filter((a) => !defenders.some((b) => canBlock(s, b, a, 1 - p)));
    sets.push(unopposed.map((o) => o.id));
    for (const keyword of [
      'flying',
      'vigilance',
      'first strike',
      'double strike',
      'lifelink',
      'trample',
    ]) {
      const group = eligible.filter((o) => hasKeyword(s, o, keyword));
      if (group.length) sets.push(group.map((o) => o.id));
    }
    for (const count of [1, 2]) {
      const selected = new Set([...unopposed, ...byPower.slice(0, count)]);
      sets.push(eligible.filter((o) => selected.has(o)).map((o) => o.id));
    }
  }
  let best = { cards: [], score: -Infinity };
  const hasAttackTriggers = Object.values(s.objects).some(
    (o) =>
      o.zone === 'battlefield' &&
      (definition(s, o).triggers ?? []).some(
        (t) => t.event === 'selfAttacks' || t.event?.event === 'attack',
      ),
  );
  const stable = { ...s, modifiers: (s.modifiers ?? []).filter((m) => m.expires !== s.turn) };
  const stableOutcome = (result) => ({
    ...result,
    values: [0, 1].map((player) =>
      result.alive
        .filter((id) => s.objects[id]?.controller === player)
        .reduce((sum, id) => sum + permanentValue(stable, s.objects[id]), 0),
    ),
  });
  const seen = new Set();
  for (const cards of sets) {
    const key = JSON.stringify(cards);
    if (seen.has(key)) continue;
    seen.add(key);
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
    if (hasAttackTriggers) scenario = projectAttackDeclaration(scenario, p, cards);
    const response =
      scenario.status === 'finished' ? null : chooseBlocks(scenario, 1 - p, { budget: 96 });
    let result =
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
        : response.outcome;
    let expense = 0;
    if (response && cards.length && improveOutcome) {
      const improved = improveOutcome({
        state: scenario,
        cards,
        response,
        evaluate: (r) => utility(stableOutcome(r), p),
      });
      if (improved) {
        result = improved.outcome;
        expense = improved.expense;
      }
    }
    // Temporary attack boosts are not permanent material won by attacking.
    let score = utility(stableOutcome(result), p) - expense;
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
      // The opponent's declared-attack payoffs matter on the return attack too.
      // Evaluate only public deterministic effects, with no invented hand/draw.
      const responding = hasAttackTriggers
        ? projectAttackDeclaration(
            reply,
            1 - p,
            incoming.map((o) => o.id),
          )
        : reply;
      const defense = chooseBlocks(responding, p, { budget: 64 }).outcome;
      if (defense.life[p] <= 0) score -= 100_000;
      else if (defense.life[p] <= 4) score -= 12;
    }
    if (score > best.score) {
      best = { cards, score };
    }
  }
  return best.cards;
}

/** A conservative defender choice: take a free planeswalker kill only when no
 * opposing creature can block and doing so does not give up lethal player damage. */
export function plannedAttackDefenders(s, player, ids) {
  const walkers = attackDefenders(s, player).filter((t) => t.kind === 'object');
  if (!walkers.length || !ids.length) return {};
  const attackers = ids.map((id) => s.objects[id]);
  const total = attackers.reduce(
    (n, o) => n + Math.max(0, stats(s, o).power) * (hasKeyword(s, o, 'double strike') ? 2 : 1),
    0,
  );
  if (total >= s.players[1 - player].life) return {};
  if (Object.values(s.objects).some((b) => attackers.some((a) => canBlock(s, b, a, 1 - player))))
    return {};
  const victim = walkers
    .filter((t) => (s.objects[t.id].loyalty ?? Infinity) <= total)
    .sort(
      (a, b) =>
        permanentValue(s, s.objects[b.id]) - permanentValue(s, s.objects[a.id]) ||
        a.id.localeCompare(b.id),
    )[0];
  if (!victim) return {};
  let needed = s.objects[victim.id].loyalty;
  const result = {};
  for (const attacker of attackers) {
    if (needed <= 0) break;
    result[attacker.id] = victim;
    needed -=
      Math.max(0, stats(s, attacker).power) * (hasKeyword(s, attacker, 'double strike') ? 2 : 1);
  }
  return result;
}
