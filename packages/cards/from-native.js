import { eventSpec } from '../engine/src/events.js';
/** Migration adapter. Native source files become the authority after conversion. */
import { targetSpec } from '../engine/src/selectors.js';
import { EVENTS, canonical } from './compiler.js';
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const mana = (cost) => {
  const result = [];
  if (Object.hasOwn(cost, 'generic')) result.push(`{${cost.generic}}`);
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'])
    for (let i = 0; i < (cost[color] ?? 0); i++) result.push(`{${color}}`);
  return result.join('') || '{0}';
};
const cost = (value) => ({
  ...value,
  ...(value.mana !== undefined ? { mana: mana(value.mana) } : {}),
});
export function sourceFromDefinition(d, { id, idsByName = {} } = {}) {
  const effects = (list) =>
    list.map((e) => {
      switch (e.op) {
        case 'destroyAll':
        case 'exileAll':
        case 'damageAll':
        case 'counterAll':
        case 'tapAll':
        case 'untapAll':
          return structuredClone(e);
        case 'modifyAll':
          return { ...structuredClone(e), until: 'endOfTurn' };
        case 'tap':
          return { op: 'tap', target: e.subject === 'source' ? 'source' : 'target' };
        case 'damage':
          return { op: 'damage', target: 'target', amount: e.amount };
        case 'damageOpponent':
          return { op: 'damage', target: 'opponent', amount: e.amount };
        case 'gainLife':
          return { op: 'gainLife', target: e.player ?? 'controller', amount: e.amount };
        case 'loseLife':
          return { op: 'loseLife', target: e.player ?? 'controller', amount: e.amount };
        case 'moveTarget':
          return {
            op: 'moveTarget',
            target: 'target',
            destination: e.destination,
            ...(e.controller !== undefined ? { controller: e.controller } : {}),
            ...(e.tapped !== undefined ? { tapped: e.tapped } : {}),
          };
        case 'draw':
        case 'scry':
        case 'surveil':
        case 'discard':
          return { op: e.op, target: e.player ?? 'controller', amount: e.count };
        case 'mill':
          return { op: 'mill', target: e.player, amount: e.count };
        case 'counter':
        case 'bounce':
        case 'destroy':
          return {
            op: { counter: 'counterSpell', bounce: 'returnToHand', destroy: 'destroy' }[e.op],
            target: 'target',
          };
        case 'modify':
          return {
            op: 'modify',
            target: e.subject === 'source' ? 'source' : 'target',
            power: e.power,
            toughness: e.toughness,
            ...(e.keywords !== undefined ? { keywords: e.keywords } : {}),
            until: 'endOfTurn',
          };
        case 'counterOn':
          return {
            op: 'addCounters',
            counter: '+1/+1',
            target: e.subject === 'source' ? 'source' : 'target',
            amount: e.amount,
          };
        case 'untap':
          return { op: 'untap', target: e.subject === 'source' ? 'source' : 'target' };
        case 'searchLibrary':
          return {
            op: 'searchLibrary',
            amount: e.count,
            destination: e.destination,
            ...(e.where ? { where: structuredClone(e.where) } : {}),
            ...(e.tapped !== undefined ? { tapped: e.tapped } : {}),
            ...(e.reveal !== undefined ? { reveal: e.reveal } : {}),
          };
        case 'token':
          if (!idsByName[e.definition]) throw new Error(`Missing token identity: ${e.definition}`);
          return {
            op: 'createToken',
            token: idsByName[e.definition],
            amount: e.count,
            ...(e.player ? { controller: e.player } : {}),
            ...(e.tapped ? { tapped: true } : {}),
          };
        default:
          throw new Error(`Cannot migrate unsupported opcode ${e.op}.`);
      }
    });
  const abilities = d.keywords.map((keyword) => ({ kind: 'keyword', keyword }));
  for (const restriction of ['cannotAttack', 'cannotBlock', 'unblockable'])
    if (d[restriction]) abilities.push({ kind: 'combatRestriction', restriction });
  if (d.cycling) abilities.push({ kind: 'cycling', cost: mana(d.cycling) });
  if (d.ward) abilities.push({ kind: 'keyword', keyword: 'ward', cost: cost(d.ward) });
  if (d.entersTapped) abilities.push({ kind: 'entry', tapped: true });
  if (d.mana)
    abilities.push({
      kind: 'mana',
      produces: Array.isArray(d.mana) ? d.mana : [d.mana],
      ...(d.manaSacrifice ? { sacrificeSelf: true } : {}),
    });
  if (d.modes)
    abilities.push({
      kind: 'modalSpell',
      choose: 1,
      modes: d.modes.map((mode) => ({
        label: mode.label,
        ...(mode.target ? { target: structuredClone(targetSpec(mode.target)) } : {}),
        effects: effects(mode.effects),
      })),
    });
  if (d.effects)
    abilities.push({
      kind: 'spell',
      ...(d.target ? { target: structuredClone(targetSpec(d.target)) } : {}),
      effects: effects(d.effects),
    });
  if (d.etb) {
    if (d.etb.length === 1 && d.etb[0].op === 'draw')
      abilities.push({ use: 'etb.draw', args: { cards: d.etb[0].count } });
    else abilities.push({ kind: 'triggered', on: EVENTS.selfEnters, effects: effects(d.etb) });
  }
  for (const t of d.triggers ?? []) {
    if (
      equal(t, {
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      })
    )
      abilities.push({ use: 'prowess' });
    else if (
      t.event === 'controllerLandEnters' &&
      !t.optional &&
      !t.target &&
      t.effects.length === 1 &&
      t.effects[0].op === 'modify' &&
      t.effects[0].subject === 'source' &&
      !t.effects[0].keywords
    )
      abilities.push({
        use: 'landfall.grow',
        args: { power: t.effects[0].power, toughness: t.effects[0].toughness },
      });
    else {
      if (!eventSpec(t.event)) throw new Error('Unknown trigger predicate.');
      abilities.push({
        kind: 'triggered',
        on: eventSpec(t.event),
        ...(t.target ? { target: structuredClone(targetSpec(t.target)) } : {}),
        ...(t.optional !== undefined ? { optional: t.optional } : {}),
        effects: effects(t.effects),
      });
    }
  }
  for (const a of d.activated ?? [])
    abilities.push({
      kind: 'activated',
      cost: cost(a.cost),
      ...(a.target ? { target: structuredClone(targetSpec(a.target)) } : {}),
      effects: effects(a.effects),
      ...(a.text !== undefined ? { text: a.text } : {}),
    });
  if (d.static) {
    if (d.static.kind !== 'anthem') throw new Error('Unsupported continuous rule.');
    abilities.push(structuredClone(d.static));
  }
  if (d.aura) {
    if (d.aura !== 'pacifism') throw new Error('Unsupported aura.');
    abilities.push({
      kind: 'aura',
      enchant: structuredClone(targetSpec('creature')),
      restriction: 'cantAttackOrBlock',
    });
  }
  const characteristics = {
    types: d.types ?? [d.type],
    supertypes: [...(d.basic ? ['basic'] : []), ...(d.legendary ? ['legendary'] : [])],
    subtypes: d.subtypes,
    colors: d.color,
    manaCost: d.type === 'land' || d.token ? null : mana(d.cost),
  };
  for (const key of ['power', 'toughness', 'token'])
    if (d[key] !== undefined) characteristics[key] = d[key];
  return {
    $schema: '../schema/card.schema.json',
    schemaVersion: 1,
    id,
    name: d.name,
    characteristics,
    rulesText: d.text,
    abilities,
  };
}
