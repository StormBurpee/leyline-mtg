import { EVENT_PRESETS, eventSpec, validateEventSpec } from '../engine/src/events.js';
import { jsonDataProblem } from './json-data.js';
import { validateDefinition } from '../engine/src/definition-validation.js';
import { primaryType } from '../engine/src/types.js';
import { targetSpec, validateTargetSpec, effectTargetCompatible } from '../engine/src/selectors.js';
export const CARD_SCHEMA_VERSION = 1;
const plain = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : plain(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const LEGACY_TARGETS = [
  'any',
  'player',
  'opponent',
  'creature',
  'nonblackCreature',
  'spell',
  'noncreatureSpell',
  'artifact',
  'enchantment',
  'artifactOrEnchantment',
  'permanent',
];
export const EVENTS = EVENT_PRESETS;
/** Compile data only. Unsupported behavior is a diagnostic, never a no-op fallback. */
export function compileCard(
  source,
  { mechanics = {}, identities = {}, adventureDepth = 0, transformBack = false } = {},
) {
  const invalidJSON = jsonDataProblem(source) ?? jsonDataProblem(mechanics);
  if (invalidJSON)
    return {
      ok: false,
      diagnostics: [{ code: 'INVALID_JSON_DATA', path: 'card', message: invalidJSON }],
    };
  const diagnostics = [];
  const problem = (code, path, message) => diagnostics.push({ code, path, message });
  const fields = (value, allowed, path) => {
    if (!plain(value)) {
      problem('INVALID_SHAPE', path, 'Expected an object.');
      return false;
    }
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) problem('UNKNOWN_FIELD', `${path}.${key}`, 'Unknown field.');
    return true;
  };
  const mana = (value, path, { allowAbsent = false } = {}) => {
    if (value === null && allowAbsent) return {};
    if (typeof value !== 'string' || value.length > 200 || !/^(?:\{[^{}]+\})+$/.test(value)) {
      problem(
        'INVALID_MANA',
        path,
        'Use braced mana symbols, or null for a land/token without a mana cost.',
      );
      return {};
    }
    const result = {};
    for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
      const symbol = match[1];
      if (/^\d+$/.test(symbol)) {
        const amount = Number(symbol);
        if (!Number.isSafeInteger(amount) || amount > 1000)
          problem('MANA_LIMIT', path, 'Literal mana amounts must be at most 1000.');
        else result.generic = (result.generic ?? 0) + amount;
      } else if (
        /^[WUBRGCX]$/.test(symbol) ||
        /^2\/[WUBRG]$/.test(symbol) ||
        (/^[WUBRG]\/[WUBRG]$/.test(symbol) && symbol[0] !== symbol[2])
      )
        result[symbol] = (result[symbol] ?? 0) + 1;
      else
        problem(
          'UNSUPPORTED_MANA',
          path,
          `Mana symbol ${symbol} needs an unimplemented cost mechanic.`,
        );
    }
    return result;
  };
  const cost = (value, path) => {
    if (
      !fields(
        value,
        ['mana', 'tap', 'life', 'sacrificeSelf', 'sacrifice', 'exileSelf', 'discard'],
        path,
      )
    )
      return {};
    return {
      ...(value.mana !== undefined ? { mana: mana(value.mana, `${path}.mana`) } : {}),
      ...(value.exileSelf !== undefined ? { exileSelf: value.exileSelf } : {}),
      ...(value.sacrificeSelf !== undefined ? { sacrificeSelf: value.sacrificeSelf } : {}),
      ...(value.sacrifice !== undefined ? { sacrifice: structuredClone(value.sacrifice) } : {}),
      ...(value.tap !== undefined ? { tap: value.tap } : {}),
      ...(value.discard !== undefined ? { discard: value.discard } : {}),
      ...(value.life !== undefined ? { life: value.life } : {}),
    };
  };
  const target = (value, path) => {
    for (const error of validateTargetSpec(value)) problem('INVALID_SELECTOR', path, error);
    return LEGACY_TARGETS.find((name) => same(targetSpec(name), value)) ?? structuredClone(value);
  };
  const effects = (values, path) => {
    if (!Array.isArray(values) || values.length > 64) {
      problem('INVALID_EFFECTS', path, 'Expected at most 64 effects.');
      return [];
    }
    return values.map((effect, i) => {
      const p = `${path}[${i}]`;
      if (!plain(effect)) {
        problem('INVALID_EFFECT', p, 'Expected an effect object.');
        return { op: 'unsupported' };
      }
      if (['damageEachPlayer', 'damageEventPlayer', 'damageTargetController'].includes(effect.op)) {
        fields(
          effect,
          ['op', 'amount', ...(effect.op === 'damageTargetController' ? ['targetGroup'] : [])],
          p,
        );
        return structuredClone(effect);
      }
      if (effect.op === 'exileGraveyards') {
        fields(effect, ['op', 'players'], p);
        return structuredClone(effect);
      }
      if (effect.op === 'questCounterTrigger') {
        fields(effect, ['op', 'threshold', 'selector', 'effects'], p);
        return {
          op: effect.op,
          threshold: effect.threshold,
          selector: target(effect.selector, `${p}.selector`),
          effects: effects(effect.effects, `${p}.effects`),
        };
      }
      if (effect.op === 'earthbend') {
        fields(effect, ['op', 'amount'], p);
        return { op: effect.op, amount: effect.amount };
      }
      if (effect.op === 'removeCounterTrigger') {
        fields(effect, ['op', 'selector', 'effects'], p);
        return {
          op: effect.op,
          selector: target(effect.selector, `${p}.selector`),
          effects: effects(effect.effects, `${p}.effects`),
        };
      }
      if (effect.op === 'discardTrigger') {
        fields(effect, ['op', 'count', 'where', 'selector', 'effects'], p);
        return {
          op: 'discardTrigger',
          count: effect.count,
          where: structuredClone(effect.where),
          selector: target(effect.selector, `${p}.selector`),
          effects: effects(effect.effects, `${p}.effects`),
        };
      }
      if (effect.op === 'behold') {
        fields(effect, ['op', 'subtype', 'then'], p);
        return { op: 'behold', subtype: effect.subtype, then: effects(effect.then, `${p}.then`) };
      }
      if (effect.op === 'chooseEffect') {
        fields(effect, ['op', 'player', 'options'], p);
        if (!Array.isArray(effect.options)) {
          problem('INVALID_EFFECT', p, 'Expected resolution alternatives.');
          return { op: 'unsupported' };
        }
        return {
          op: 'chooseEffect',
          ...(effect.player !== undefined ? { player: effect.player } : {}),
          options: effect.options.map((option, j) => {
            if (!fields(option, ['label', 'condition', 'effects'], `${p}.options[${j}]`))
              return { label: '', effects: [] };
            return {
              label: option.label,
              ...(option.condition !== undefined
                ? { condition: structuredClone(option.condition) }
                : {}),
              effects: effects(option.effects, `${p}.options[${j}].effects`),
            };
          }),
        };
      }
      if (effect.op === 'conditional') {
        fields(effect, ['op', 'condition', 'then', 'else'], p);
        return {
          op: 'conditional',
          condition: structuredClone(effect.condition),
          then: effects(effect.then, `${p}.then`),
          ...(effect.else !== undefined ? { else: effects(effect.else, `${p}.else`) } : {}),
        };
      }
      if (effect.targetGroup !== undefined) {
        const { targetGroup, ...rest } = effect;
        const native = effects([rest], p)[0];
        return { ...native, targetGroup };
      }
      if (effect.op === 'fight' || effect.op === 'bite') {
        fields(effect, ['op', 'source', 'sourceGroup', 'victimGroup'], p);
        return structuredClone(effect);
      }
      if (
        ![
          'damage',
          'damageEventOpponent',
          'damageEventPowerOpponent',
          'drawEventAmount',
          'moveLinkedExileToGraveyard',
          'exileUntilSourceLeavesAll',
          'endTurn',
          'chooseLandName',
          'exileGraveyards',
          'disableDamagePrevention',
          'discover',
          'impulseCastOrDamage',
          'castDamageEmblem',
          'anthemEmblem',
          'exileTop',
          'returnTransformed',
          'chooseMana',
          'combatMana',
          'addMana',
          'impulseChoose',
          'bindingNegotiation',
          'revealDiscard',
          'gainLife',
          'loseLife',
          'moveTarget',
          'exileUntilSourceLeaves',
          'delayedBlink',
          'draw',
          'mill',
          'scry',
          'lookChooseHand',
          'surveil',
          'explore',
          'discard',
          'optionalDiscardDraw',
          'sacrifice',
          'sacrificeSelf',
          'chooseExile',
          'returnSelfAsEnchantment',
          'shuffleSourceAndTarget',
          'searchLibrary',
          'counterSpell',
          'returnToHand',
          'destroy',
          'attachEquipment',
          'creatureForm',
          'animateLand',
          'keywordCounters',
          'removeAbilities',
          'counterAbility',
          'stripDestroyByManaValue',
          'becomeLand',
          'modify',
          'combatRestriction',
          'createToken',
          'mobilize',
          'empowerJace',
          'copyToken',
          'untapSearched',
          'fightAttached',
          'doubleCounters',
          'doublePower',
          'addCounters',
          'keywordCounter',
          'addStunCounters',
          'untap',
          'tap',
          'prepare',
          'unprepare',
          'bounceAll',
          'destroyAll',
          'exileAll',
          'exileUntilSourceLeavesAll',
          'modifyAll',
          'damageAll',
          'counterAll',
          'tapAll',
          'untapAll',
        ].includes(effect.op)
      ) {
        problem('UNSUPPORTED_EFFECT', `${p}.op`, 'Unknown authoring instruction.');
        return { op: 'unsupported' };
      }
      const nativeOp =
        {
          counterSpell: 'counter',
          returnToHand: 'bounce',
          createToken: 'token',
          addCounters: 'counterOn',
          addStunCounters: 'stunOn',
        }[effect.op] ?? effect.op;
      const allowed = {
        damage: ['target', 'amount'],
        damageOpponent: ['amount'],
        damageEventOpponent: ['amount'],
        damageEventPowerOpponent: [],
        drawEventAmount: [],
        endTurn: [],
        chooseLandName: [],
        moveLinkedExileToGraveyard: [],
        exileUntilSourceLeavesAll: ['where'],
        disableDamagePrevention: [],
        exileGraveyards: ['players'],
        exileTop: ['count', 'player', 'duration', 'castOnly', 'anyMana'],
        discover: ['amount'],
        impulseCastOrDamage: ['amount'],
        castDamageEmblem: ['amount'],
        anthemEmblem: ['where', 'power', 'toughness'],
        returnTransformed: [],
        chooseMana: [],
        combatMana: ['count'],
        addMana: ['mana'],
        impulseChoose: ['amount'],
        bindingNegotiation: [],
        revealDiscard: ['where'],
        gainLife: ['target', 'amount'],
        loseLife: ['target', 'amount'],
        exileUntilSourceLeaves: ['target'],
        delayedBlink: ['target', 'controller'],
        moveTarget: ['target', 'destination', 'controller', 'tapped', 'trackSource'],
        draw: ['target', 'amount'],
        mill: ['target', 'amount'],
        lookChooseHand: [
          'target',
          'amount',
          'selectCount',
          'restOrder',
          'where',
          'optional',
          'reveal',
          'revealAll',
          'restDestination',
        ],
        scry: ['target', 'amount'],
        surveil: ['target', 'amount'],
        explore: ['target'],
        discard: ['target', 'amount'],
        optionalDiscardDraw: [],
        sacrifice: ['count', 'player', 'where'],
        sacrificeSelf: [],
        chooseExile: ['count', 'player', 'where'],
        returnSelfAsEnchantment: [],
        shuffleSourceAndTarget: [],
        searchLibrary: [
          'amount',
          'where',
          'destination',
          'tapped',
          'reveal',
          'player',
          'optional',
          'countFrom',
        ],
        counter: ['target', 'unlessPay', 'exile'],
        bounce: ['target'],
        destroy: ['target'],
        attachEquipment: ['target'],
        becomeLand: ['mana', 'until'],
        creatureForm: ['target', 'power', 'toughness', 'subtypes', 'until'],
        animateLand: [
          'power',
          'toughness',
          'colors',
          'subtypes',
          'until',
          'keywords',
          'allCreatureTypes',
        ],
        keywordCounters: ['keywords'],
        removeAbilities: ['until'],
        counterAbility: ['removeSourceAbilities'],
        stripDestroyByManaValue: ['amount'],
        modify: ['target', 'power', 'toughness', 'keywords', 'until'],
        combatRestriction: ['target', 'restriction', 'until'],
        token: ['token', 'amount', 'controller', 'tapped', 'temporaryKeywords', 'countFrom'],
        mobilize: ['token', 'amount'],
        empowerJace: ['token', 'amount'],
        copyToken: ['target', 'count', 'exceptions'],
        fightAttached: ['target'],
        untapSearched: [],
        doubleCounters: ['target', 'where'],
        doublePower: ['target'],
        counterOn: ['target', 'amount', 'counter'],
        keywordCounter: ['target', 'keyword', 'amount'],
        stunOn: ['target', 'amount'],
        untap: ['target'],
        tap: ['target'],
        prepare: ['target'],
        unprepare: ['target'],
        bounceAll: ['where', 'excludeSource'],
        destroyAll: ['where', 'excludeSource'],
        exileAll: ['where', 'excludeSource', 'player', 'rememberMovedCount'],
        modifyAll: ['where', 'excludeSource', 'power', 'toughness', 'keywords', 'until'],
        damageAll: ['where', 'excludeSource', 'amount', 'players'],
        counterAll: ['where', 'excludeSource', 'amount', 'counter'],
        tapAll: ['where', 'excludeSource'],
        untapAll: ['where', 'excludeSource'],
      }[nativeOp];
      if (!Array.isArray(allowed)) {
        problem(
          'UNSUPPORTED_EFFECT',
          `${p}.op`,
          `Effect ${String(effect.op)} has no runtime implementation.`,
        );
        return { op: 'unsupported' };
      }
      fields(effect, ['op', ...allowed], p);
      if (
        [
          'discover',
          'impulseCastOrDamage',
          'castDamageEmblem',
          'anthemEmblem',
          'exileTop',
          'returnTransformed',
          'chooseMana',
          'combatMana',
        ].includes(effect.op)
      )
        return structuredClone(effect);
      const e = {
        op: nativeOp === 'damage' && effect.target === 'opponent' ? 'damageOpponent' : nativeOp,
      };
      if (
        [
          'damage',
          'damageOpponent',
          'damageEventOpponent',
          'gainLife',
          'loseLife',
          'counterOn',
          'stunOn',
        ].includes(e.op)
      )
        e.amount = effect.amount;
      if (['sacrifice', 'chooseExile'].includes(e.op)) {
        e.count = effect.count;
        e.player = effect.player;
        if (effect.where !== undefined) e.where = structuredClone(effect.where);
      }
      if (e.op === 'lookChooseHand') {
        if (effect.selectCount !== undefined) e.selectCount = structuredClone(effect.selectCount);
        if (effect.restOrder !== undefined) e.restOrder = effect.restOrder;
        for (const key of ['where', 'optional', 'reveal', 'revealAll', 'restDestination'])
          if (effect[key] !== undefined) e[key] = structuredClone(effect[key]);
      }
      if (e.op === 'explore') {
        if (!['source', 'target'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source or target.');
        if (effect.target === 'source') e.subject = 'source';
      }
      if (e.op === 'addMana') e.mana = mana(effect.mana, `${p}.mana`);
      if (
        [
          'draw',
          'mill',
          'scry',
          'lookChooseHand',
          'surveil',
          'discard',
          'token',
          'mobilize',
          'empowerJace',
          'impulseChoose',
        ].includes(e.op)
      )
        e.count = effect.amount;
      if (
        ['draw', 'gainLife', 'loseLife', 'scry', 'lookChooseHand', 'surveil', 'discard'].includes(
          e.op,
        )
      ) {
        if (!['controller', 'opponent', 'target'].includes(effect.target))
          problem(
            'UNSUPPORTED_RECIPIENT',
            `${p}.target`,
            'Expected controller, opponent or target.',
          );
        else if (effect.target !== 'controller') e.player = effect.target;
      }
      if (
        [
          'bounceAll',
          'destroyAll',
          'exileAll',
          'exileUntilSourceLeavesAll',
          'modifyAll',
          'damageAll',
          'counterAll',
          'tapAll',
          'untapAll',
        ].includes(e.op)
      ) {
        for (const key of [
          'where',
          'excludeSource',
          'rememberMovedCount',
          'amount',
          'players',
          'power',
          'toughness',
          'keywords',
        ])
          if (effect[key] !== undefined) e[key] = structuredClone(effect[key]);
        if (e.op === 'modifyAll' && effect.until !== 'endOfTurn')
          problem(
            'UNSUPPORTED_DURATION',
            `${p}.until`,
            'Only end-of-turn group modifiers are implemented.',
          );
      }
      if (e.op === 'copyToken') {
        if (!['target', 'source'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Copy needs a permanent target or source.');
        if (effect.target === 'source') e.subject = 'source';
        e.count = effect.count;
        if (effect.exceptions !== undefined) e.exceptions = structuredClone(effect.exceptions);
      }
      if (e.op === 'keywordCounter') {
        e.subject = effect.target;
        e.keyword = effect.keyword;
        e.amount = effect.amount;
      }
      if (e.op === 'token') {
        if (effect.countFrom !== undefined) e.countFrom = effect.countFrom;
        if (effect.temporaryKeywords !== undefined)
          e.temporaryKeywords = structuredClone(effect.temporaryKeywords);
        if (effect.controller !== undefined) e.player = effect.controller;
        if (effect.tapped !== undefined) e.tapped = effect.tapped;
      }
      if (e.op === 'exileAll' && effect.player !== undefined) e.player = effect.player;
      if (e.op === 'searchLibrary') {
        e.count = effect.amount;
        e.destination = effect.destination;
        if (effect.where !== undefined) e.where = structuredClone(effect.where);
        if (effect.tapped !== undefined) e.tapped = effect.tapped;
        if (effect.reveal !== undefined) e.reveal = effect.reveal;
        for (const key of ['player', 'optional', 'countFrom'])
          if (effect[key] !== undefined) e[key] = effect[key];
      }
      if (e.op === 'revealDiscard' && effect.where !== undefined)
        e.where = structuredClone(effect.where);
      if (e.op === 'counter') {
        if (effect.unlessPay !== undefined) e.unlessPay = structuredClone(effect.unlessPay);
        if (effect.exile !== undefined) e.exile = effect.exile;
      }
      if (e.op === 'delayedBlink' && effect.controller !== undefined)
        e.controller = effect.controller;
      if (e.op === 'moveTarget') {
        if (!['source', 'attached', 'target'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'A zone change needs a supported binding.');
        if (effect.target !== 'target') e.subject = effect.target;
        e.destination = effect.destination;
        if (effect.trackSource !== undefined) e.trackSource = effect.trackSource;
        if (effect.controller !== undefined) e.controller = effect.controller;
        if (effect.tapped !== undefined) e.tapped = effect.tapped;
      }
      if (
        [
          'fightAttached',
          'damage',
          'counter',
          'attachEquipment',
          'exileUntilSourceLeaves',
          'delayedBlink',
        ].includes(e.op) &&
        effect.target !== 'target'
      )
        problem(
          'UNSUPPORTED_BINDING',
          `${p}.target`,
          'This instruction requires the declared target binding.',
        );
      if (['bounce', 'destroy'].includes(e.op)) {
        if (!['source', 'attached', 'target'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source, attached or target.');
        if (effect.target !== 'target') e.subject = effect.target;
      }
      if (e.op === 'mill')
        e.player =
          effect.target === 'target'
            ? 'target'
            : effect.target === 'controller'
              ? 'controller'
              : effect.target === 'opponent'
                ? 'opponent'
                : null;
      if (['doubleCounters', 'doublePower'].includes(e.op)) {
        if (effect.where !== undefined) {
          if (e.op !== 'doubleCounters' || effect.target !== undefined)
            problem('UNSUPPORTED_BINDING', p, 'Group doubling requires only where.');
          e.where = structuredClone(effect.where);
        } else {
          if (!['source', 'target', 'attached'].includes(effect.target))
            problem('UNSUPPORTED_BINDING', p, 'Expected source, target or attached.');
          if (effect.target !== 'target') e.subject = effect.target;
        }
      }
      if (['counterOn', 'counterAll'].includes(e.op)) {
        const counter =
          e.op === 'counterAll' && effect.counter === undefined ? '+1/+1' : effect.counter;
        if (!['+1/+1', '-1/-1'].includes(counter))
          problem('UNSUPPORTED_COUNTER', `${p}.counter`, 'Expected +1/+1 or -1/-1 counters.');
        // Keep the existing implicit +1/+1 native contract and replay representation.
        if (counter === '-1/-1') e.counter = counter;
      }
      if (e.op === 'counterOn' || e.op === 'stunOn') {
        if (!['source', 'target', 'attached'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source or target.');
        if (['source', 'attached'].includes(effect.target)) e.subject = effect.target;
      }
      if (['untap', 'tap', 'prepare', 'unprepare'].includes(e.op)) {
        if (!['source', 'target', 'attached'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source or target.');
        if (['source', 'attached'].includes(effect.target)) e.subject = effect.target;
      }
      if (e.op === 'becomeLand') {
        if (effect.until !== 'yourNextTurn')
          problem('UNSUPPORTED_DURATION', `${p}.until`, 'Expected yourNextTurn.');
        e.mana = effect.mana;
      }
      if (e.op === 'creatureForm') {
        if (effect.target !== 'target' || effect.until !== 'endOfTurn')
          problem('UNSUPPORTED_FORM', p, 'Creature forms require a target and endOfTurn duration.');
        Object.assign(e, {
          power: effect.power,
          toughness: effect.toughness,
          subtypes: effect.subtypes,
        });
      }
      if (e.op === 'animateLand') {
        if (!['endOfTurn', 'permanent'].includes(effect.until))
          problem('UNSUPPORTED_DURATION', `${p}.until`, 'Expected endOfTurn or permanent.');
        Object.assign(e, {
          power: effect.power,
          toughness: effect.toughness,
          ...(effect.colors !== undefined ? { colors: effect.colors } : {}),
          subtypes: effect.subtypes,
          ...(effect.keywords !== undefined ? { keywords: effect.keywords } : {}),
          ...(effect.allCreatureTypes ? { allCreatureTypes: true } : {}),
          ...(effect.until === 'permanent' ? { permanent: true } : {}),
        });
      }
      if (e.op === 'combatRestriction') {
        if (!['source', 'target', 'attached'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source, attached or target.');
        if (effect.until !== 'endOfTurn')
          problem('UNSUPPORTED_DURATION', `${p}.until`, 'Expected endOfTurn.');
        if (['source', 'attached'].includes(effect.target)) e.subject = effect.target;
        e.restriction = effect.restriction;
      }
      if (e.op === 'removeAbilities') e.until = effect.until;
      if (e.op === 'counterAbility' && effect.removeSourceAbilities !== undefined)
        e.removeSourceAbilities = effect.removeSourceAbilities;
      if (e.op === 'stripDestroyByManaValue') e.amount = structuredClone(effect.amount);
      if (e.op === 'exileGraveyards') e.players = effect.players;
      if (e.op === 'keywordCounters') e.keywords = structuredClone(effect.keywords);
      if (e.op === 'modify') {
        if (!['source', 'target', 'attached'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source or target.');
        if (effect.until !== 'endOfTurn')
          problem(
            'UNSUPPORTED_DURATION',
            `${p}.until`,
            'Only end-of-turn modifications are implemented.',
          );
        Object.assign(e, {
          ...(['source', 'attached'].includes(effect.target) ? { subject: effect.target } : {}),
          power: effect.power,
          toughness: effect.toughness,
          ...(effect.keywords !== undefined ? { keywords: effect.keywords } : {}),
        });
      }
      if (['token', 'mobilize', 'empowerJace'].includes(e.op)) {
        e.definition = Object.hasOwn(identities, effect.token) ? identities[effect.token] : null;
        if (!e.definition)
          problem('UNKNOWN_TOKEN', `${p}.token`, 'Token identity is not in this pack.');
      }
      return e;
    });
  };
  if (
    !fields(
      source,
      ['$schema', 'schemaVersion', 'id', 'name', 'characteristics', 'rulesText', 'abilities'],
      'card',
    )
  )
    return { ok: false, diagnostics };
  if (source.schemaVersion !== CARD_SCHEMA_VERSION)
    problem('SCHEMA_VERSION', 'schemaVersion', 'Unsupported card schema version.');
  if (
    typeof source.id !== 'string' ||
    !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z][a-z0-9.-]*:[A-Za-z0-9_/-]+)$/.test(
      source.id,
    ) ||
    source.id.length > 200
  )
    problem('INVALID_ID', 'id', 'A stable card identity is required.');
  const c = source.characteristics;
  if (
    !fields(
      c,
      [
        'types',
        'supertypes',
        'subtypes',
        'colors',
        'manaCost',
        'power',
        'toughness',
        'loyalty',
        'token',
      ],
      'characteristics',
    )
  )
    return { ok: false, diagnostics };
  if (!Array.isArray(c.types) || !c.types.length)
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        {
          code: 'INVALID_TYPES',
          path: 'characteristics.types',
          message: 'At least one card type is required.',
        },
      ],
    };
  const d = {
    name: source.name,
    type: primaryType(c.types),
    types: structuredClone(c.types),
    cost: mana(c.manaCost, 'characteristics.manaCost', {
      allowAbsent: transformBack || c.types.includes('land') || c.token === true,
    }),
    keywords: [],
    subtypes: structuredClone(c.subtypes ?? []),
    color: structuredClone(c.colors ?? []),
    text: source.rulesText ?? '',
  };
  if (
    c.supertypes !== undefined &&
    (!Array.isArray(c.supertypes) || c.supertypes.some((t) => !['basic', 'legendary'].includes(t)))
  )
    problem(
      'UNSUPPORTED_SUPERTYPE',
      'characteristics.supertypes',
      'Only basic and legendary supertypes are implemented in this runtime profile.',
    );
  if (c.supertypes?.includes('basic')) d.basic = true;
  if (c.supertypes?.includes('legendary')) d.legendary = true;
  for (const key of ['power', 'toughness', 'loyalty', 'token'])
    if (c[key] !== undefined) d[key] = c[key];
  const expanded = [];
  let expansionSteps = 0;
  const expand = (list, chain = []) => {
    if (!Array.isArray(list) || list.length > 64) {
      problem('INVALID_ABILITIES', 'abilities', 'Expected at most 64 abilities.');
      return;
    }
    for (const ability of list) {
      if (++expansionSteps > 256 || expanded.length >= 64) {
        problem('ABILITY_LIMIT', 'abilities', 'Mechanic expansion exceeds its budget.');
        return;
      }
      if (!plain(ability)) {
        problem('INVALID_ABILITY', 'abilities', 'Expected an ability object.');
        continue;
      }
      if (!Object.hasOwn(ability, 'use')) {
        expanded.push(ability);
        continue;
      }
      fields(ability, ['use', 'args'], 'abilities.use');
      if (typeof ability.use !== 'string') {
        problem('INVALID_MECHANIC', 'abilities.use', 'Mechanic references must be strings.');
        continue;
      }
      if (chain.includes(ability.use) || chain.length >= 8) {
        problem('MECHANIC_CYCLE', 'abilities.use', 'Mechanic expansion is cyclic or too deep.');
        continue;
      }
      const template = Object.hasOwn(mechanics, ability.use) ? mechanics[ability.use] : null;
      if (!plain(template) || !plain(template.parameters)) {
        problem('UNKNOWN_MECHANIC', 'abilities.use', `Unknown mechanic ${String(ability.use)}.`);
        continue;
      }
      if (jsonDataProblem(template)) {
        problem('INVALID_TEMPLATE', 'abilities.use', 'Mechanics must contain bounded JSON data.');
        continue;
      }
      const args = ability.args ?? {};
      if (!plain(args)) {
        problem('INVALID_ARGUMENTS', 'abilities.args', 'Expected named arguments.');
        continue;
      }
      for (const key of Object.keys(args))
        if (!Object.hasOwn(template.parameters, key))
          problem('UNKNOWN_ARGUMENT', `abilities.args.${key}`, 'Unknown mechanic argument.');
      for (const [key, rule] of Object.entries(template.parameters))
        if (
          !plain(rule) ||
          rule.type !== 'integer' ||
          !Number.isSafeInteger(rule.min) ||
          !Number.isSafeInteger(rule.max) ||
          rule.min > rule.max ||
          !Number.isSafeInteger(args[key]) ||
          args[key] < rule.min ||
          args[key] > rule.max
        )
          problem(
            'INVALID_ARGUMENT',
            `abilities.args.${key}`,
            'Mechanic argument does not satisfy its declared bounds.',
          );
      const substitute = (value, depth = 0) => {
        if (depth > 20) {
          problem('TEMPLATE_DEPTH', 'abilities.use', 'Template data is too deep.');
          return null;
        }
        if (Array.isArray(value)) return value.map((child) => substitute(child, depth + 1));
        if (plain(value)) {
          if (Object.keys(value).length === 1 && Object.hasOwn(value, '$param')) {
            if (typeof value.$param !== 'string') {
              problem('INVALID_TEMPLATE', 'abilities.use', 'Parameter references must be strings.');
              return undefined;
            }
            if (!Object.hasOwn(args, value.$param))
              problem('MISSING_ARGUMENT', 'abilities.args', 'Unbound mechanic parameter.');
            return structuredClone(args[value.$param]);
          }
          return Object.fromEntries(
            Object.entries(value).map(([key, v]) => [key, substitute(v, depth + 1)]),
          );
        }
        return value;
      };
      expand(substitute(template.abilities), [...chain, ability.use]);
    }
  };
  expand(source.abilities);
  if (expanded.length > 64)
    problem('ABILITY_LIMIT', 'abilities', 'Expanded ability count exceeds 64.');
  let spells = 0;
  for (const [i, a] of expanded.entries()) {
    const path = `abilities[${i}]`;
    if (typeof a.kind !== 'string') {
      problem('INVALID_ABILITY_KIND', path, 'Ability kinds must be strings.');
      continue;
    }
    switch (a.kind) {
      case 'landNameLock':
        fields(a, ['kind'], path);
        d.landNameLock = true;
        break;
      case 'exileGraveyardMoves':
        fields(a, ['kind'], path);
        d.exileGraveyardMoves = true;
        break;
      case 'manaFromTrackedExile':
        fields(a, ['kind'], path);
        d.manaFromTrackedExile = true;
        break;
      case 'libraryTopAccess':
        fields(a, ['kind', 'play'], path);
        d.libraryTopAccess = { play: structuredClone(a.play) };
        break;
      case 'additionalEnterTrigger':
        fields(a, ['kind', 'where'], path);
        d.additionalEnterTrigger = structuredClone(a.where);
        break;
      case 'suppressEnterTriggers':
        fields(a, ['kind', 'where'], path);
        d.suppressEnterTriggers = structuredClone(a.where);
        break;
      case 'uncounterable':
        fields(a, ['kind'], path);
        d.uncounterable = true;
        break;
      case 'chooseBasicLandType':
        fields(a, ['kind'], path);
        d.chooseBasicLandType = true;
        break;
      case 'chooseCreatureType':
        fields(a, ['kind'], path);
        d.chooseCreatureType = true;
        break;
      case 'bargain':
        fields(a, ['kind'], path);
        d.bargain = true;
        break;
      case 'kicker':
        fields(a, ['kind', 'cost', 'effects'], path);
        d.kicker = {
          cost: mana(a.cost, `${path}.cost`),
          effects: effects(a.effects, `${path}.effects`),
        };
        break;
      case 'prepare': {
        fields(a, ['kind', 'mainName', 'spell', 'entersPrepared'], path);
        if (d.prepareSpell || adventureDepth > 0) {
          problem('NESTED_PREPARE', path, 'Only one nonnested prepare spell is supported.');
          break;
        }
        const result = compileCard(a.spell, {
          mechanics,
          identities,
          adventureDepth: adventureDepth + 1,
        });
        if (!result.ok)
          diagnostics.push(
            ...result.diagnostics.map((v) => ({ ...v, path: `${path}.spell.${v.path}` })),
          );
        else {
          d.prepareSpell = result.definition;
          d.mainName = a.mainName;
          d.entersPrepared = a.entersPrepared;
        }
        break;
      }
      case 'transformFace': {
        fields(a, ['kind', 'frontName', 'back'], path);
        if (d.backFace || adventureDepth > 0) {
          problem('NESTED_TRANSFORM', path, 'Transform faces cannot nest.');
          break;
        }
        const result = compileCard(a.back, {
          mechanics,
          identities,
          adventureDepth: adventureDepth + 1,
          transformBack: true,
        });
        if (!result.ok)
          diagnostics.push(
            ...result.diagnostics.map((v) => ({ ...v, path: `${path}.back.${v.path}` })),
          );
        else {
          d.backFace = result.definition;
          d.frontName = a.frontName;
        }
        break;
      }
      case 'adventure': {
        fields(a, ['kind', 'mainName', 'spell'], path);
        if (d.adventure) problem('DUPLICATE_ADVENTURE', path, 'Only one Adventure is supported.');
        if (
          adventureDepth > 0 ||
          a.spell?.abilities?.some((ability) => ability.kind === 'adventure')
        ) {
          problem('NESTED_ADVENTURE', path, 'An Adventure cannot itself contain an Adventure.');
          break;
        }
        const result = compileCard(a.spell, {
          mechanics,
          identities,
          adventureDepth: adventureDepth + 1,
        });
        if (!result.ok)
          diagnostics.push(
            ...result.diagnostics.map((v) => ({ ...v, path: `${path}.spell.${v.path}` })),
          );
        else {
          d.adventure = result.definition;
          d.mainName = a.mainName;
        }
        break;
      }
      case 'warp':
        fields(a, ['kind', 'cost'], path);
        if (d.warp) problem('DUPLICATE_WARP', path, 'Only one warp ability is supported.');
        d.warp = mana(a.cost, `${path}.cost`);
        break;
      case 'plot':
        fields(a, ['kind', 'cost'], path);
        if (d.plot) problem('DUPLICATE_PLOT', path, 'Only one plot ability is supported.');
        d.plot = mana(a.cost, `${path}.cost`);
        break;
      case 'harmonize':
        fields(a, ['kind', 'cost'], path);
        if (d.harmonize)
          problem('DUPLICATE_HARMONIZE', path, 'Only one harmonize ability is supported.');
        d.harmonize = mana(a.cost, `${path}.cost`);
        break;
      case 'flashback':
        fields(a, ['kind', 'cost'], path);
        if (d.flashback)
          problem('DUPLICATE_FLASHBACK', path, 'Only one flashback ability is supported.');
        d.flashback = mana(a.cost, `${path}.cost`);
        break;
      case 'disguise':
        fields(a, ['kind', 'cost'], path);
        d.disguise = mana(a.cost, `${path}.cost`);
        break;
      case 'offspring':
        fields(a, ['kind', 'cost'], path);
        d.offspring = mana(a.cost, `${path}.cost`);
        break;
      case 'startEngines':
        fields(a, ['kind'], path);
        d.startEngines = true;
        break;
      case 'maxSpeedKeywords':
        fields(a, ['kind', 'keywords'], path);
        d.maxSpeedKeywords = structuredClone(a.keywords);
        break;
      case 'entryKeywordCounters':
        fields(a, ['kind', 'keywords'], path);
        d.entryKeywordCounters = structuredClone(a.keywords);
        break;
      case 'entryPlusCounters':
        fields(a, ['kind', 'amount'], path);
        d.entryPlusCounters = structuredClone(a.amount);
        break;
      case 'entryStunCounters':
        fields(a, ['kind', 'amount'], path);
        d.entryStunCounters = a.amount;
        break;
      case 'entryCounterBonus':
        fields(a, ['kind', 'amount', 'condition'], path);
        d.entryCounterBonus = { amount: a.amount, condition: structuredClone(a.condition) };
        break;
      case 'foreignCreatureSubtype':
        fields(a, ['kind', 'subtype'], path);
        d.foreignCreatureSubtype = a.subtype;
        break;
      case 'gift':
        fields(a, ['kind', 'token', 'effects'], path);
        d.gift = {
          definition: identities[a.token] ?? a.token,
          effects: effects(a.effects, `${path}.effects`),
        };
        break;
      case 'globalRule':
        fields(a, ['kind', 'rule'], path);
        if (!['cantGainLife', 'cantPreventDamage'].includes(a.rule))
          problem('UNSUPPORTED_GLOBAL_RULE', path, 'Unsupported global rule.');
        else d[a.rule] = true;
        break;
      case 'drawBonus':
        fields(a, ['kind', 'amount', 'handAtMost'], path);
        d.drawBonus = { amount: a.amount, handAtMost: a.handAtMost };
        break;
      case 'damageBonus':
        fields(a, ['kind', 'amount', 'where'], path);
        d.damageBonus = { amount: a.amount, where: structuredClone(a.where) };
        break;
      case 'keyword':
        fields(a, ['kind', 'keyword', 'cost'], path);
        if (a.keyword === 'ward') {
          if (d.ward)
            problem('MULTIPLE_WARD', path, 'Multiple ward instances are not implemented.');
          d.ward = cost(a.cost, `${path}.cost`);
        } else {
          if (a.cost !== undefined)
            problem('UNEXPECTED_COST', path, 'Only ward takes a keyword cost in this profile.');
          d.keywords.push(a.keyword);
        }
        break;
      case 'distributedCounters':
        spells++;
        fields(a, ['kind', 'selector'], path);
        d.distributedCounters = target(a.selector, `${path}.selector`);
        d.effects = [{ op: 'distributedCounters' }];
        break;
      case 'combatRestriction':
        fields(a, ['kind', 'restriction', 'condition'], path);
        if (
          !['cannotAttack', 'cannotBlock', 'unblockable', 'cannotBeBlockedByLowerPower'].includes(
            a.restriction,
          )
        )
          problem('UNSUPPORTED_RESTRICTION', path, 'Unsupported combat restriction.');
        else if (a.condition !== undefined)
          (d.conditionalCombatRestrictions ??= []).push({
            restriction: a.restriction,
            condition: structuredClone(a.condition),
          });
        else d[a.restriction] = true;
        break;
      case 'saddle':
      case 'crewSaddlePowerBonus':
        fields(a, ['kind', 'power'], path);
        if (!Number.isSafeInteger(a.power) || a.power < 0 || a.power > 1000)
          problem('INVALID_TAP_POWER', path, 'Requires integer power from 0 to 1000.');
        if (d[a.kind] !== undefined)
          problem('DUPLICATE_TAP_POWER', path, 'Duplicate tap-power ability.');
        d[a.kind] = a.power;
        break;
      case 'crew':
        fields(a, ['kind', 'power'], path);
        if (!Number.isSafeInteger(a.power) || a.power < 0 || a.power > 1000)
          problem('INVALID_CREW', path, 'Crew requires an integer power from 0 to 1000.');
        if (d.crew !== undefined)
          problem('DUPLICATE_CREW', path, 'Only one crew ability is supported.');
        d.crew = a.power;
        break;
      case 'cycling':
        fields(a, ['kind', 'cost', 'type'], path);
        if (a.type !== undefined) d.cyclingType = a.type;
        if (d.cycling) problem('DUPLICATE_CYCLING', path, 'Only one cycling ability is supported.');
        d.cycling = mana(a.cost, `${path}.cost`);
        break;
      case 'mana':
        fields(
          a,
          ['kind', 'produces', 'sacrificeSelf', 'conditions', 'restrictions', 'lifeCosts'],
          path,
        );
        if (a.lifeCosts !== undefined) d.manaLifeCosts = structuredClone(a.lifeCosts);
        if (a.restrictions !== undefined) d.manaRestrictions = structuredClone(a.restrictions);
        if (a.conditions !== undefined) d.manaConditions = structuredClone(a.conditions);
        if (a.sacrificeSelf !== undefined) d.manaSacrifice = a.sacrificeSelf;
        if (d.mana)
          problem('MULTIPLE_MANA', path, 'Only one single-mana source ability is supported.');
        if (!Array.isArray(a.produces) || !a.produces.length)
          problem('INVALID_PRODUCTION', path, 'List the available mana colors.');
        d.mana =
          Array.isArray(a.produces) && a.produces.length === 1
            ? a.produces[0]
            : structuredClone(a.produces);
        break;
      case 'spell':
        fields(a, ['kind', 'target', 'targetGroups', 'effects'], path);
        spells++;
        d.target = a.target === undefined ? null : target(a.target, `${path}.target`);
        if (a.targetGroups !== undefined) d.targetGroups = structuredClone(a.targetGroups);
        d.effects = effects(a.effects, `${path}.effects`);
        break;
      case 'modalSpell':
        fields(a, ['kind', 'choose', 'modes'], path);
        if (a.choose === 'oneOrMore') d.spree = true;
        spells++;
        if (a.choose !== 1 && a.choose !== 'oneOrMore')
          problem(
            'UNSUPPORTED_MODE_COUNT',
            `${path}.choose`,
            'Only choose-one spells are implemented.',
          );
        if (!Array.isArray(a.modes) || a.modes.length < 2 || a.modes.length > 8)
          problem('INVALID_MODES', `${path}.modes`, 'Expected 2–8 modes.');
        else
          d.modes = a.modes.map((mode, i) => {
            const mp = `${path}.modes[${i}]`;
            fields(mode, ['label', 'target', 'targetGroups', 'effects', 'additionalCost'], mp);
            return {
              label: mode?.label,
              ...(mode?.additionalCost !== undefined
                ? { additionalCost: mana(mode.additionalCost, `${mp}.additionalCost`) }
                : {}),
              ...(mode?.targetGroups ? { targetGroups: structuredClone(mode.targetGroups) } : {}),
              ...(mode?.target !== undefined
                ? { target: target(mode.target, `${mp}.target`) }
                : {}),
              effects: effects(mode?.effects, `${mp}.effects`),
            };
          });
        break;
      case 'activated':
        fields(
          a,
          [
            'kind',
            'cost',
            'zone',
            'target',
            'targetGroups',
            'effects',
            'text',
            'timing',
            'condition',
            'oncePerTurn',
            'powerUp',
            'exhaust',
            'loyalty',
          ],
          path,
        );
        (d.activated ??= []).push({
          ...(a.zone !== undefined ? { zone: a.zone } : {}),
          cost: cost(a.cost, `${path}.cost`),
          ...(a.target !== undefined ? { target: target(a.target, `${path}.target`) } : {}),
          ...(a.targetGroups ? { targetGroups: structuredClone(a.targetGroups) } : {}),
          effects: effects(a.effects, `${path}.effects`),
          ...(a.text !== undefined ? { text: a.text } : {}),
          ...(a.timing !== undefined ? { timing: a.timing } : {}),
          ...(a.condition !== undefined ? { condition: structuredClone(a.condition) } : {}),
          ...(a.oncePerTurn !== undefined ? { oncePerTurn: a.oncePerTurn } : {}),
          ...(a.powerUp !== undefined ? { powerUp: a.powerUp } : {}),
          ...(a.exhaust !== undefined ? { exhaust: a.exhaust } : {}),
          ...(a.loyalty !== undefined ? { loyalty: a.loyalty } : {}),
        });
        break;
      case 'triggered': {
        fields(
          a,
          [
            'kind',
            'on',
            'optional',
            'target',
            'targetGroups',
            'effects',
            'condition',
            'triggerCondition',
            'oncePerTurn',
            'choose',
            'modes',
          ],
          path,
        );
        if (a.optional !== undefined && typeof a.optional !== 'boolean')
          problem('INVALID_OPTIONAL', path, 'Optional must be a boolean.');
        for (const error of validateEventSpec(a.on))
          problem('UNSUPPORTED_EVENT', `${path}.on`, error);
        const event =
          Object.keys(EVENTS).find((key) => same(EVENTS[key], a.on)) ?? structuredClone(a.on);
        let modes;
        if (a.modes !== undefined || a.choose !== undefined) {
          if (a.choose !== 1)
            problem(
              'UNSUPPORTED_MODE_COUNT',
              `${path}.choose`,
              'Only choose-one triggered abilities are implemented.',
            );
          if (a.effects !== undefined || a.target !== undefined || a.targetGroups !== undefined)
            problem('SHARED_MODE_FIELDS', path, 'Triggered modes cannot share effects or targets.');
          if (!Array.isArray(a.modes) || a.modes.length < 2 || a.modes.length > 8)
            problem('INVALID_MODES', `${path}.modes`, 'Expected 2–8 modes.');
          else
            modes = a.modes.map((mode, index) => {
              const mp = `${path}.modes[${index}]`;
              fields(mode, ['label', 'target', 'targetGroups', 'effects'], mp);
              return {
                label: mode?.label,
                ...(mode?.target !== undefined
                  ? { target: target(mode.target, `${mp}.target`) }
                  : {}),
                ...(mode?.targetGroups !== undefined
                  ? { targetGroups: structuredClone(mode.targetGroups) }
                  : {}),
                effects: effects(mode?.effects, `${mp}.effects`),
              };
            });
        }
        const instructions = modes ? undefined : effects(a.effects, `${path}.effects`);
        if (
          event === 'selfEnters' &&
          !modes &&
          !a.condition &&
          !a.triggerCondition &&
          !a.oncePerTurn &&
          !a.optional &&
          !a.target &&
          !a.targetGroups &&
          !d.etb
        )
          d.etb = instructions;
        else
          (d.triggers ??= []).push({
            event,
            ...(modes ? { modes } : { effects: instructions }),
            ...(a.condition ? { condition: structuredClone(a.condition) } : {}),
            ...(a.triggerCondition
              ? { triggerCondition: structuredClone(a.triggerCondition) }
              : {}),
            ...(a.target !== undefined ? { target: target(a.target, `${path}.target`) } : {}),
            ...(a.targetGroups ? { targetGroups: structuredClone(a.targetGroups) } : {}),
            ...(a.optional !== undefined ? { optional: a.optional } : {}),
            ...(a.oncePerTurn !== undefined ? { oncePerTurn: a.oncePerTurn } : {}),
          });
        break;
      }
      case 'entry':
        fields(a, ['kind', 'tapped', 'unless', 'payLife'], path);
        if (a.payLife !== undefined) {
          if (a.unless !== undefined)
            problem('UNSUPPORTED_ENTRY', path, 'Life entry and unless cannot share one clause.');
          d.entryLifePayment = a.payLife;
        }
        if (a.unless !== undefined) d.entersTappedUnless = structuredClone(a.unless);
        if (a.tapped !== true)
          problem('UNSUPPORTED_ENTRY', path, 'Only unconditional tapped entry is implemented.');
        if (d.entersTapped) problem('DUPLICATE_ENTRY', path, 'Entry replacement is repeated.');
        if (a.unless === undefined && a.payLife === undefined) d.entersTapped = true;
        break;
      case 'anthem':
        fields(a, ['kind', 'power', 'toughness', 'where', 'excludeSource', 'keywords'], path);
        if (d.static)
          problem(
            'MULTIPLE_STATIC',
            path,
            'This profile supports one controller-wide creature anthem.',
          );
        d.static = {
          kind: 'anthem',
          power: a.power,
          toughness: a.toughness,
          ...Object.fromEntries(
            ['where', 'excludeSource', 'keywords']
              .filter((k) => a[k] !== undefined)
              .map((k) => [k, structuredClone(a[k])]),
          ),
        };
        break;
      case 'additionalCost':
        fields(a, ['kind', 'cost'], path);
        d.additionalCost = structuredClone(a.cost);
        break;
      case 'sacrificeCost':
        fields(a, ['kind', 'where'], path);
        if (d.sacrificeCost)
          problem('DUPLICATE_COST', path, 'Only one sacrifice casting cost is supported.');
        d.sacrificeCost = { where: structuredClone(a.where) };
        break;
      case 'costModifier':
        fields(a, ['kind', 'scope', 'change', 'amount', 'where', 'targetWhere', 'condition'], path);
        (d.costModifiers ??= []).push(
          Object.fromEntries(
            ['scope', 'change', 'amount', 'where', 'targetWhere', 'condition']
              .filter((k) => a[k] !== undefined)
              .map((k) => [k, structuredClone(a[k])]),
          ),
        );
        break;
      case 'opponentCreatureProtectionBypass':
        fields(a, ['kind'], path);
        d.opponentCreatureProtectionBypass = true;
        break;
      case 'conditionalBonus':
        fields(a, ['kind', 'affects', 'condition', 'power', 'toughness', 'keywords'], path);
        (d.conditionalBonuses ??= []).push(
          Object.fromEntries(
            ['affects', 'condition', 'power', 'toughness', 'keywords']
              .filter((k) => a[k] !== undefined)
              .map((k) => [k, structuredClone(a[k])]),
          ),
        );
        break;
      case 'ninjutsu':
        fields(a, ['kind', 'cost'], path);
        d.ninjutsu = mana(a.cost, `${path}.cost`);
        break;
      case 'turnLoyaltyCreature':
        fields(a, ['kind', 'power', 'toughness', 'subtypes', 'keywords'], path);
        {
          const { kind, ...form } = a;
          d.turnLoyaltyCreature = structuredClone(form);
        }
        break;
      case 'baseStats':
      case 'selfBonus':
        fields(a, ['kind', 'power', 'toughness'], path);
        if (d[a.kind]) problem('MULTIPLE_STAT_RULE', path, 'Combine stat rules into one ability.');
        d[a.kind] = Object.fromEntries(
          ['power', 'toughness']
            .filter((k) => a[k] !== undefined)
            .map((k) => [k, structuredClone(a[k])]),
        );
        break;
      case 'attachmentBonus':
        fields(a, ['kind', 'power', 'toughness', 'keywords', 'noUntap', 'maxBlockers'], path);
        if (d.attachmentBonus)
          problem(
            'MULTIPLE_ATTACHMENT_BONUS',
            path,
            'Combine attachment bonuses into one instruction.',
          );
        if (a.keywords !== undefined && !Array.isArray(a.keywords))
          problem('INVALID_KEYWORDS', path, 'Expected an array of keywords.');
        d.attachmentBonus = {
          power: a.power,
          toughness: a.toughness,
          ...(Array.isArray(a.keywords) ? { keywords: [...a.keywords] } : {}),
          ...(a.noUntap !== undefined ? { noUntap: a.noUntap } : {}),
          ...(a.maxBlockers !== undefined ? { maxBlockers: a.maxBlockers } : {}),
        };
        break;
      case 'equip':
        fields(a, ['kind', 'cost', 'where'], path);
        if (!d.subtypes.includes('Equipment'))
          problem('EQUIP_TYPE', path, 'Equip requires Equipment.');
        (d.activated ??= []).push({
          cost:
            typeof a.cost === 'string'
              ? { mana: mana(a.cost, `${path}.cost`) }
              : cost(a.cost, `${path}.cost`),
          timing: 'sorcery',
          target: {
            scope: 'permanent',
            where: {
              all: [
                { type: 'creature' },
                { controller: 'you' },
                ...(a.where ? [structuredClone(a.where)] : []),
              ],
            },
          },
          effects: [{ op: 'attachEquipment' }],
          text: 'Equip',
        });
        break;
      case 'aura':
        fields(a, ['kind', 'enchant', 'restriction'], path);
        if (
          !effectTargetCompatible('attachEquipment', a.enchant) ||
          (a.restriction !== undefined && a.restriction !== 'cantAttackOrBlock') ||
          d.aura
        )
          problem(
            'UNSUPPORTED_AURA',
            path,
            'Expected a creature enchant selector and an optional combat restriction.',
          );
        d.aura = a.restriction ? 'pacifism' : 'creature';
        d.target = same(a.enchant, targetSpec('creature'))
          ? 'creature'
          : structuredClone(a.enchant);
        break;
      default:
        problem(
          'UNSUPPORTED_ABILITY',
          `${path}.kind`,
          `Ability kind ${String(a.kind)} is not implemented.`,
        );
    }
  }
  if (['instant', 'sorcery'].includes(d.type) ? spells !== 1 : spells !== 0)
    problem(
      'SPELL_ABILITY_COUNT',
      'abilities',
      'Instants/sorceries need exactly one spell ability; permanents need none.',
    );
  for (const message of validateDefinition(d)) problem('RUNTIME_CONTRACT', 'card', message);
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, id: source.id, definition: d, diagnostics: [] };
}
