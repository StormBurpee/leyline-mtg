import { eventSpec } from '../engine/src/events.js';
/** Migration adapter. Native source files become the authority after conversion. */
import { targetSpec } from '../engine/src/selectors.js';
import { EVENTS, canonical } from './compiler.js';
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const mana = (cost) => {
  const result = [];
  if (Object.hasOwn(cost, 'generic')) result.push(`{${cost.generic}}`);
  for (const [symbol, n] of Object.entries(cost)
    .filter(([symbol]) => symbol.includes('/'))
    .sort())
    for (let i = 0; i < n; i++) result.push(`{${symbol}}`);
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
        case 'impulseChoose':
          return { op: 'impulseChoose', amount: e.count };
        case 'attachEquipment':
          return { op: 'attachEquipment', target: 'target' };
        case 'bindingNegotiation':
          return { op: 'bindingNegotiation' };
        case 'addMana':
          return { op: 'addMana', mana: mana(e.mana) };
        case 'damageEventPowerOpponent':
        case 'damageEventOpponent':
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
          return { op: 'tap', target: e.subject ?? 'target' };
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
            target: e.subject ?? 'target',
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
            target: e.subject ?? 'target',
          };
        case 'modify':
          return {
            op: 'modify',
            target: e.subject ?? 'target',
            power: e.power,
            toughness: e.toughness,
            ...(e.keywords !== undefined ? { keywords: e.keywords } : {}),
            until: 'endOfTurn',
          };
        case 'counterOn':
          return {
            op: 'addCounters',
            counter: '+1/+1',
            target: e.subject ?? 'target',
            amount: e.amount,
          };
        case 'untap':
          return { op: 'untap', target: e.subject ?? 'target' };
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
            ...(e.temporaryKeywords ? { temporaryKeywords: [...e.temporaryKeywords] } : {}),
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
  if (d.entersTappedUnless)
    abilities.push({ kind: 'entry', tapped: true, unless: structuredClone(d.entersTappedUnless) });
  if (d.mana)
    abilities.push({
      kind: 'mana',
      ...(d.manaConditions ? { conditions: structuredClone(d.manaConditions) } : {}),
      ...(d.manaRestrictions ? { restrictions: structuredClone(d.manaRestrictions) } : {}),
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
        ...(t.condition ? { condition: structuredClone(t.condition) } : {}),
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
      ...(a.timing ? { timing: a.timing } : {}),
      ...(a.condition ? { condition: structuredClone(a.condition) } : {}),
      ...(a.oncePerTurn !== undefined ? { oncePerTurn: a.oncePerTurn } : {}),
    });
  if (d.uncounterable) abilities.push({ kind: 'uncounterable' });
  if (d.chooseCreatureType) abilities.push({ kind: 'chooseCreatureType' });
  if (d.kicker)
    abilities.push({
      kind: 'kicker',
      cost: mana(d.kicker.cost),
      effects: effects(d.kicker.effects),
    });
  if (d.disguise) abilities.push({ kind: 'disguise', cost: mana(d.disguise) });
  if (d.offspring) abilities.push({ kind: 'offspring', cost: mana(d.offspring) });
  if (d.startEngines) abilities.push({ kind: 'startEngines' });
  if (d.maxSpeedKeywords)
    abilities.push({ kind: 'maxSpeedKeywords', keywords: [...d.maxSpeedKeywords] });
  if (d.entryCounterBonus)
    abilities.push({ kind: 'entryCounterBonus', ...structuredClone(d.entryCounterBonus) });
  if (d.damageBonus) abilities.push({ kind: 'damageBonus', ...structuredClone(d.damageBonus) });
  if (d.static) {
    if (d.static.kind !== 'anthem') throw new Error('Unsupported continuous rule.');
    abilities.push(structuredClone(d.static));
  }
  for (const bonus of d.conditionalBonuses ?? [])
    abilities.push({ kind: 'conditionalBonus', ...structuredClone(bonus) });
  for (const kind of ['baseStats', 'selfBonus'])
    if (d[kind]) abilities.push({ kind, ...structuredClone(d[kind]) });
  if (d.attachmentBonus)
    abilities.push({ kind: 'attachmentBonus', ...structuredClone(d.attachmentBonus) });
  if (d.aura) {
    if (!['pacifism', 'creature'].includes(d.aura)) throw new Error('Unsupported aura.');
    abilities.push({
      kind: 'aura',
      enchant: structuredClone(targetSpec(d.target)),
      ...(d.aura === 'pacifism' ? { restriction: 'cantAttackOrBlock' } : {}),
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
