import { eventSpec } from '../engine/src/events.js';
/** Migration adapter. Native source files become the authority after conversion. */
import { targetSpec } from '../engine/src/selectors.js';
import { EVENTS, canonical } from './compiler.js';
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const mana = (cost) => {
  const result = Array.from({ length: cost.X ?? 0 }, () => '{X}');
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
      if (e.op === 'earthbend') return structuredClone(e);
      if (e.op === 'questCounterTrigger')
        return {
          ...structuredClone(e),
          selector: structuredClone(targetSpec(e.selector)),
          effects: effects(e.effects),
        };
      if (e.op === 'removeCounterTrigger')
        return {
          ...structuredClone(e),
          selector: structuredClone(targetSpec(e.selector)),
          effects: effects(e.effects),
        };
      if (e.op === 'discardTrigger')
        return {
          ...structuredClone(e),
          selector: structuredClone(targetSpec(e.selector)),
          effects: effects(e.effects),
        };
      if (e.op === 'behold') return { ...structuredClone(e), then: effects(e.then) };
      if (e.op === 'chooseEffect')
        return {
          ...structuredClone(e),
          options: e.options.map((option) => ({
            ...structuredClone(option),
            effects: effects(option.effects),
          })),
        };
      if (e.op === 'conditional')
        return {
          op: 'conditional',
          condition: structuredClone(e.condition),
          then: effects(e.then),
          ...(e.else !== undefined ? { else: effects(e.else) } : {}),
        };
      if (e.targetGroup !== undefined) {
        const { targetGroup, ...rest } = e;
        return { ...effects([rest])[0], targetGroup };
      }
      switch (e.op) {
        case 'mobilize':
        case 'empowerJace':
          return {
            op: e.op,
            amount: e.count,
            token: idsByName[e.definition] ?? e.definition,
          };
        case 'copyToken': {
          const { subject, ...rest } = structuredClone(e);
          return { ...rest, target: subject ?? 'target' };
        }
        case 'damageTargetController':
        case 'damageEachPlayer':
        case 'damageEventPlayer':
        case 'exileGraveyards':
        case 'optionalDiscardDraw':
        case 'chooseExile':
        case 'returnSelfAsEnchantment':
        case 'shuffleSourceAndTarget':
        case 'discover':
        case 'impulseCastOrDamage':
        case 'castDamageEmblem':
        case 'anthemEmblem':
        case 'exileTop':
        case 'returnTransformed':
        case 'chooseMana':
        case 'combatMana':
        case 'sacrifice':
        case 'sacrificeSelf':
        case 'fight':
        case 'bite':
          return structuredClone(e);
        case 'impulseChoose':
          return { op: 'impulseChoose', amount: e.count };
        case 'attachEquipment':
          return { op: 'attachEquipment', target: 'target' };
        case 'explore':
          return { op: 'explore', target: e.subject ?? 'target' };
        case 'revealDiscard':
          return structuredClone(e);
        case 'bindingNegotiation':
          return { op: 'bindingNegotiation' };
        case 'addMana':
          return { op: 'addMana', mana: mana(e.mana) };
        case 'moveLinkedExileToGraveyard':
        case 'exileUntilSourceLeavesAll':
        case 'endTurn':
        case 'chooseLandName':
        case 'disableDamagePrevention':
        case 'drawEventAmount':
        case 'damageEventPowerOpponent':
        case 'damageEventOpponent':
        case 'bounceAll':
        case 'destroyAll':
        case 'exileAll':
        case 'damageAll':
        case 'counterAll':
        case 'tapAll':
        case 'untapAll':
          return structuredClone(e);
        case 'modifyAll':
          return { ...structuredClone(e), until: 'endOfTurn' };
        case 'keywordCounter':
          return { op: e.op, target: e.subject, keyword: e.keyword, amount: e.amount };
        case 'stunOn':
          return { op: 'addStunCounters', target: e.subject ?? 'target', amount: e.amount };
        case 'prepare':
        case 'unprepare':
        case 'tap':
          return { op: e.op, target: e.subject ?? 'target' };
        case 'damage':
          return { op: 'damage', target: 'target', amount: e.amount };
        case 'damageOpponent':
          return { op: 'damage', target: 'opponent', amount: e.amount };
        case 'gainLife':
          return { op: 'gainLife', target: e.player ?? 'controller', amount: e.amount };
        case 'loseLife':
          return { op: 'loseLife', target: e.player ?? 'controller', amount: e.amount };
        case 'delayedBlink':
          return { ...e, target: 'target' };
        case 'exileUntilSourceLeaves':
          return { op: e.op, target: 'target' };
        case 'moveTarget':
          if (e.attachedToken && !idsByName[e.attachedToken])
            throw new Error(`Missing token identity: ${e.attachedToken}`);
          return {
            op: 'moveTarget',
            target: e.subject ?? 'target',
            destination: e.destination,
            ...(e.controller !== undefined ? { controller: e.controller } : {}),
            ...(e.tapped !== undefined ? { tapped: e.tapped } : {}),
            ...(e.trackSource !== undefined ? { trackSource: e.trackSource } : {}),
            ...(e.attachedToken ? { attachedToken: idsByName[e.attachedToken] } : {}),
          };
        case 'draw':
        case 'lookChooseHand':
        case 'scry':
        case 'surveil':
        case 'discard':
          return {
            op: e.op,
            target: e.player ?? 'controller',
            amount: e.count,
            ...(e.op === 'lookChooseHand' && e.selectCount !== undefined
              ? { selectCount: structuredClone(e.selectCount) }
              : {}),
            ...(e.op === 'lookChooseHand' && e.restOrder !== undefined
              ? { restOrder: e.restOrder }
              : {}),
            ...(e.op === 'lookChooseHand'
              ? Object.fromEntries(
                  ['where', 'optional', 'reveal', 'revealAll', 'restDestination']
                    .filter((key) => e[key] !== undefined)
                    .map((key) => [key, structuredClone(e[key])]),
                )
              : {}),
          };
        case 'mill':
          return { op: 'mill', target: e.player, amount: e.count };
        case 'counter':
        case 'bounce':
        case 'destroy':
          return {
            ...(e.unlessPay !== undefined ? { unlessPay: structuredClone(e.unlessPay) } : {}),
            ...(e.exile !== undefined ? { exile: e.exile } : {}),
            op: { counter: 'counterSpell', bounce: 'returnToHand', destroy: 'destroy' }[e.op],
            target: e.subject ?? 'target',
          };
        case 'becomeLand':
          return { ...structuredClone(e), until: 'yourNextTurn' };
        case 'creatureForm':
          return { ...structuredClone(e), target: 'target', until: 'endOfTurn' };
        case 'combatRestriction':
          return {
            op: e.op,
            target: e.subject ?? 'target',
            restriction: e.restriction,
            until: 'endOfTurn',
          };
        case 'animateLand': {
          const { permanent, ...rest } = e;
          return { ...structuredClone(rest), until: permanent ? 'permanent' : 'endOfTurn' };
        }
        case 'removeAbilities':
        case 'counterAbility':
        case 'stripDestroyByManaValue':
        case 'keywordCounters':
          return structuredClone(e);
        case 'modify':
          return {
            op: 'modify',
            target: e.subject ?? 'target',
            power: e.power,
            toughness: e.toughness,
            ...(e.keywords !== undefined ? { keywords: e.keywords } : {}),
            until: 'endOfTurn',
          };
        case 'fightAttached':
          return { op: e.op, target: 'target' };
        case 'untapSearched':
          return { op: e.op };
        case 'doubleCounters':
        case 'doublePower':
          return {
            op: e.op,
            ...(e.where ? { where: structuredClone(e.where) } : { target: e.subject ?? 'target' }),
          };
        case 'counterOn':
          return {
            op: 'addCounters',
            counter: e.counter ?? '+1/+1',
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
            ...Object.fromEntries(
              ['player', 'optional', 'countFrom']
                .filter((k) => e[k] !== undefined)
                .map((k) => [k, e[k]]),
            ),
          };
        case 'grantDeathReturn':
          if (!idsByName[e.attachedToken])
            throw new Error(`Missing token identity: ${e.attachedToken}`);
          return {
            op: e.op,
            target: 'target',
            attachedToken: idsByName[e.attachedToken],
            until: 'endOfTurn',
            ...(e.tapped !== undefined ? { tapped: e.tapped } : {}),
          };
        case 'attachedToken':
          if (!idsByName[e.definition]) throw new Error(`Missing token identity: ${e.definition}`);
          return {
            op: 'createAttachedToken',
            token: idsByName[e.definition],
            target: e.subject ?? 'target',
          };
        case 'token':
          if (!idsByName[e.definition]) throw new Error(`Missing token identity: ${e.definition}`);
          return {
            op: 'createToken',
            ...(e.countFrom !== undefined ? { countFrom: e.countFrom } : {}),
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
  for (const rule of d.conditionalCombatRestrictions ?? [])
    abilities.push({ kind: 'combatRestriction', ...structuredClone(rule) });
  for (const restriction of [
    'cannotAttack',
    'cannotBlock',
    'unblockable',
    'cannotBeBlockedByLowerPower',
  ])
    if (d[restriction]) abilities.push({ kind: 'combatRestriction', restriction });
  if (d.entryKeywordCounters)
    abilities.push({ kind: 'entryKeywordCounters', keywords: [...d.entryKeywordCounters] });
  if (d.entryPlusCounters !== undefined)
    abilities.push({ kind: 'entryPlusCounters', amount: structuredClone(d.entryPlusCounters) });
  if (d.landNameLock) abilities.push({ kind: 'landNameLock' });
  if (d.exileGraveyardMoves) abilities.push({ kind: 'exileGraveyardMoves' });
  if (d.suppressEnterTriggers)
    abilities.push({
      kind: 'suppressEnterTriggers',
      where: structuredClone(d.suppressEnterTriggers),
    });
  if (d.libraryTopAccess)
    abilities.push({ kind: 'libraryTopAccess', play: structuredClone(d.libraryTopAccess.play) });
  if (d.additionalEnterTrigger)
    abilities.push({
      kind: 'additionalEnterTrigger',
      where: structuredClone(d.additionalEnterTrigger),
    });
  if (d.manaFromTrackedExile) abilities.push({ kind: 'manaFromTrackedExile' });
  if (d.prepareSpell)
    abilities.push({
      kind: 'prepare',
      mainName: d.mainName,
      entersPrepared: d.entersPrepared,
      spell: sourceFromDefinition(d.prepareSpell, {
        id: `leyline:prepare/${d.prepareSpell.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        idsByName,
      }),
    });
  if (d.distributedCounters)
    abilities.push({
      kind: 'distributedCounters',
      selector: structuredClone(targetSpec(d.distributedCounters)),
    });
  if (d.backFace) {
    const back = sourceFromDefinition(d.backFace, {
      id: `leyline:back/${d.backFace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      idsByName,
    });
    if (!Object.keys(d.backFace.cost).length) back.characteristics.manaCost = null;
    abilities.push({ kind: 'transformFace', frontName: d.frontName, back });
  }
  if (d.adventure)
    abilities.push({
      kind: 'adventure',
      mainName: d.mainName,
      spell: sourceFromDefinition(d.adventure, {
        id: `leyline:adventure/${d.adventure.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        idsByName,
      }),
    });
  if (d.ninjutsu) abilities.push({ kind: 'ninjutsu', cost: mana(d.ninjutsu) });
  if (d.turnLoyaltyCreature)
    abilities.push({ kind: 'turnLoyaltyCreature', ...d.turnLoyaltyCreature });
  if (d.additionalCost)
    abilities.push({ kind: 'additionalCost', cost: structuredClone(d.additionalCost) });
  if (d.warp) abilities.push({ kind: 'warp', cost: mana(d.warp) });
  if (d.plot) abilities.push({ kind: 'plot', cost: mana(d.plot) });
  if (d.harmonize) abilities.push({ kind: 'harmonize', cost: mana(d.harmonize) });
  if (d.flashback) abilities.push({ kind: 'flashback', cost: mana(d.flashback) });
  for (const kind of ['saddle', 'crewSaddlePowerBonus'])
    if (d[kind] !== undefined) abilities.push({ kind, power: d[kind] });
  if (d.crew !== undefined) abilities.push({ kind: 'crew', power: d.crew });
  if (d.cycling)
    abilities.push({
      kind: 'cycling',
      cost: mana(d.cycling),
      ...(d.cyclingType ? { type: d.cyclingType } : {}),
    });
  if (d.opponentCreatureProtectionBypass)
    abilities.push({ kind: 'opponentCreatureProtectionBypass' });
  if (d.ward) abilities.push({ kind: 'keyword', keyword: 'ward', cost: cost(d.ward) });
  if (d.entryLifePayment)
    abilities.push({ kind: 'entry', tapped: true, payLife: d.entryLifePayment });
  if (d.entersTapped) abilities.push({ kind: 'entry', tapped: true });
  if (d.entersTappedUnless)
    abilities.push({ kind: 'entry', tapped: true, unless: structuredClone(d.entersTappedUnless) });
  if (d.mana)
    abilities.push({
      kind: 'mana',
      ...(d.manaConditions ? { conditions: structuredClone(d.manaConditions) } : {}),
      ...(d.manaLifeCosts ? { lifeCosts: structuredClone(d.manaLifeCosts) } : {}),
      ...(d.manaRestrictions ? { restrictions: structuredClone(d.manaRestrictions) } : {}),
      produces: Array.isArray(d.mana) ? d.mana : [d.mana],
      ...(d.manaSacrifice ? { sacrificeSelf: true } : {}),
    });
  if (d.foreignCreatureSubtype)
    abilities.push({ kind: 'foreignCreatureSubtype', subtype: d.foreignCreatureSubtype });
  if (d.gift)
    abilities.push({
      kind: 'gift',
      token: idsByName[d.gift.definition] ?? d.gift.definition,
      effects: effects(d.gift.effects),
    });
  if (d.modes)
    abilities.push({
      kind: 'modalSpell',
      choose: d.spree ? 'oneOrMore' : 1,
      modes: d.modes.map((mode) => ({
        label: mode.label,
        ...(mode.additionalCost !== undefined ? { additionalCost: mana(mode.additionalCost) } : {}),
        ...(mode.targetGroups ? { targetGroups: structuredClone(mode.targetGroups) } : {}),
        ...(mode.target ? { target: structuredClone(targetSpec(mode.target)) } : {}),
        effects: effects(mode.effects),
      })),
    });
  if (d.effects && !d.distributedCounters)
    abilities.push({
      kind: 'spell',
      ...(d.targetGroups ? { targetGroups: structuredClone(d.targetGroups) } : {}),
      ...(d.target ? { target: structuredClone(targetSpec(d.target)) } : {}),
      effects: effects(d.effects),
    });
  if (d.etb) {
    if (d.etb.length === 1 && d.etb[0].op === 'draw' && Number.isInteger(d.etb[0].count))
      abilities.push({ use: 'etb.draw', args: { cards: d.etb[0].count } });
    else abilities.push({ kind: 'triggered', on: EVENTS.selfEnters, effects: effects(d.etb) });
  }
  for (const t of d.attachmentTriggers ?? [])
    abilities.push({
      kind: 'attachmentTriggered',
      on: eventSpec(t.event),
      effects: effects(t.effects),
      ...(t.condition ? { condition: structuredClone(t.condition) } : {}),
    });
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
      !t.condition &&
      !t.triggerCondition &&
      !t.optional &&
      !t.oncePerTurn &&
      !t.target &&
      t.effects?.length === 1 &&
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
        ...(t.targetGroups ? { targetGroups: structuredClone(t.targetGroups) } : {}),
        ...(t.target ? { target: structuredClone(targetSpec(t.target)) } : {}),
        ...(t.optional !== undefined ? { optional: t.optional } : {}),
        ...(t.oncePerTurn !== undefined ? { oncePerTurn: t.oncePerTurn } : {}),
        ...(t.condition ? { condition: structuredClone(t.condition) } : {}),
        ...(t.triggerCondition ? { triggerCondition: structuredClone(t.triggerCondition) } : {}),
        ...(t.modes
          ? {
              choose: 1,
              modes: t.modes.map((mode) => ({
                label: mode.label,
                ...(mode.target ? { target: structuredClone(targetSpec(mode.target)) } : {}),
                ...(mode.targetGroups ? { targetGroups: structuredClone(mode.targetGroups) } : {}),
                effects: effects(mode.effects),
              })),
            }
          : { effects: effects(t.effects) }),
      });
    }
  }
  for (const a of d.activated ?? [])
    abilities.push({
      kind: 'activated',
      ...(a.zone !== undefined ? { zone: a.zone } : {}),
      ...(a.targetGroups ? { targetGroups: structuredClone(a.targetGroups) } : {}),
      cost: cost(a.cost),
      ...(a.target ? { target: structuredClone(targetSpec(a.target)) } : {}),
      effects: effects(a.effects),
      ...(a.text !== undefined ? { text: a.text } : {}),
      ...(a.timing ? { timing: a.timing } : {}),
      ...(a.condition ? { condition: structuredClone(a.condition) } : {}),
      ...(a.oncePerTurn !== undefined ? { oncePerTurn: a.oncePerTurn } : {}),
      ...(a.powerUp !== undefined ? { powerUp: a.powerUp } : {}),
      ...(a.exhaust !== undefined ? { exhaust: a.exhaust } : {}),
      ...(a.loyalty !== undefined ? { loyalty: a.loyalty } : {}),
    });
  if (d.uncounterable) abilities.push({ kind: 'uncounterable' });
  if (d.chooseBasicLandType) abilities.push({ kind: 'chooseBasicLandType' });
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
  if (d.entryStunCounters !== undefined)
    abilities.push({ kind: 'entryStunCounters', amount: d.entryStunCounters });
  if (d.entryCounterBonus)
    abilities.push({ kind: 'entryCounterBonus', ...structuredClone(d.entryCounterBonus) });
  for (const rule of ['cantGainLife', 'cantPreventDamage'])
    if (d[rule]) abilities.push({ kind: 'globalRule', rule });
  if (d.drawBonus) abilities.push({ kind: 'drawBonus', ...structuredClone(d.drawBonus) });
  if (d.damageBonus) abilities.push({ kind: 'damageBonus', ...structuredClone(d.damageBonus) });
  if (d.static) {
    if (d.static.kind !== 'anthem') throw new Error('Unsupported continuous rule.');
    abilities.push(structuredClone(d.static));
  }
  if (d.bargain) abilities.push({ kind: 'bargain' });
  if (d.sacrificeCost)
    abilities.push({ kind: 'sacrificeCost', ...structuredClone(d.sacrificeCost) });
  for (const modifier of d.costModifiers ?? [])
    abilities.push({ kind: 'costModifier', ...structuredClone(modifier) });
  for (const bonus of d.conditionalBonuses ?? [])
    abilities.push({ kind: 'conditionalBonus', ...structuredClone(bonus) });
  for (const kind of ['baseStats', 'selfBonus'])
    if (d[kind]) abilities.push({ kind, ...structuredClone(d[kind]) });
  if (d.attachmentBonus)
    abilities.push({
      kind: 'attachmentBonus',
      ...structuredClone(d.attachmentBonus),
      ...(d.attachmentBonus.ward ? { ward: cost(d.attachmentBonus.ward) } : {}),
    });
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
  for (const key of ['power', 'toughness', 'loyalty', 'token'])
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
