import { EVENT_PRESETS, eventSpec, validateEventSpec } from '../engine/src/events.js';
import { jsonDataProblem } from './json-data.js';
import { validateDefinition } from '../engine/src/definition-validation.js';
import { primaryType } from '../engine/src/types.js';
import { targetSpec, validateTargetSpec } from '../engine/src/selectors.js';
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
export function compileCard(source, { mechanics = {}, identities = {} } = {}) {
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
      } else if (/^[WUBRGC]$/.test(symbol)) result[symbol] = (result[symbol] ?? 0) + 1;
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
    if (!fields(value, ['mana', 'tap', 'life', 'sacrificeSelf'], path)) return {};
    return {
      ...(value.mana !== undefined ? { mana: mana(value.mana, `${path}.mana`) } : {}),
      ...(value.sacrificeSelf !== undefined ? { sacrificeSelf: value.sacrificeSelf } : {}),
      ...(value.tap !== undefined ? { tap: value.tap } : {}),
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
      if (
        ![
          'damage',
          'gainLife',
          'loseLife',
          'moveTarget',
          'draw',
          'mill',
          'scry',
          'surveil',
          'discard',
          'searchLibrary',
          'counterSpell',
          'returnToHand',
          'destroy',
          'modify',
          'createToken',
          'addCounters',
          'untap',
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
        }[effect.op] ?? effect.op;
      const allowed = {
        damage: ['target', 'amount'],
        damageOpponent: ['amount'],
        gainLife: ['target', 'amount'],
        loseLife: ['target', 'amount'],
        moveTarget: ['target', 'destination', 'controller', 'tapped'],
        draw: ['target', 'amount'],
        mill: ['target', 'amount'],
        scry: ['target', 'amount'],
        surveil: ['target', 'amount'],
        discard: ['target', 'amount'],
        searchLibrary: ['amount', 'where', 'destination', 'tapped', 'reveal'],
        counter: ['target'],
        bounce: ['target'],
        destroy: ['target'],
        modify: ['target', 'power', 'toughness', 'keywords', 'until'],
        token: ['token', 'amount'],
        counterOn: ['target', 'amount', 'counter'],
        untap: ['target'],
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
      const e = {
        op: nativeOp === 'damage' && effect.target === 'opponent' ? 'damageOpponent' : nativeOp,
      };
      if (['damage', 'damageOpponent', 'gainLife', 'loseLife', 'counterOn'].includes(e.op))
        e.amount = effect.amount;
      if (['draw', 'mill', 'scry', 'surveil', 'discard', 'token'].includes(e.op))
        e.count = effect.amount;
      if (['draw', 'gainLife', 'loseLife', 'scry', 'surveil', 'discard'].includes(e.op)) {
        if (!['controller', 'opponent', 'target'].includes(effect.target))
          problem(
            'UNSUPPORTED_RECIPIENT',
            `${p}.target`,
            'Expected controller, opponent or target.',
          );
        else if (effect.target !== 'controller') e.player = effect.target;
      }
      if (e.op === 'searchLibrary') {
        e.count = effect.amount;
        e.destination = effect.destination;
        if (effect.where !== undefined) e.where = structuredClone(effect.where);
        if (effect.tapped !== undefined) e.tapped = effect.tapped;
        if (effect.reveal !== undefined) e.reveal = effect.reveal;
      }
      if (e.op === 'moveTarget') {
        if (effect.target !== 'target')
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'A zone change needs a declared target.');
        e.destination = effect.destination;
        if (effect.controller !== undefined) e.controller = effect.controller;
        if (effect.tapped !== undefined) e.tapped = effect.tapped;
      }
      if (['damage', 'counter', 'bounce', 'destroy'].includes(e.op) && effect.target !== 'target')
        problem(
          'UNSUPPORTED_BINDING',
          `${p}.target`,
          'This instruction requires the declared target binding.',
        );
      if (e.op === 'mill')
        e.player =
          effect.target === 'target'
            ? 'target'
            : effect.target === 'controller'
              ? 'controller'
              : effect.target === 'opponent'
                ? 'opponent'
                : null;
      if (e.op === 'counterOn' && effect.counter !== '+1/+1')
        problem('UNSUPPORTED_COUNTER', `${p}.counter`, 'Only +1/+1 counters are implemented.');
      if (e.op === 'counterOn') {
        if (effect.target !== 'source')
          problem(
            'UNSUPPORTED_BINDING',
            `${p}.target`,
            'This instruction currently affects its source only.',
          );
        e.subject = 'source';
      }
      if (e.op === 'untap') {
        if (!['source', 'target'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source or target.');
        if (effect.target === 'source') e.subject = 'source';
      }
      if (e.op === 'modify') {
        if (!['source', 'target'].includes(effect.target))
          problem('UNSUPPORTED_BINDING', `${p}.target`, 'Expected source or target.');
        if (effect.until !== 'endOfTurn')
          problem(
            'UNSUPPORTED_DURATION',
            `${p}.until`,
            'Only end-of-turn modifications are implemented.',
          );
        Object.assign(e, {
          ...(effect.target === 'source' ? { subject: 'source' } : {}),
          power: effect.power,
          toughness: effect.toughness,
          ...(effect.keywords !== undefined ? { keywords: effect.keywords } : {}),
        });
      }
      if (e.op === 'token') {
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
      ['types', 'supertypes', 'subtypes', 'colors', 'manaCost', 'power', 'toughness', 'token'],
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
      allowAbsent: c.types.includes('land') || c.token === true,
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
  for (const key of ['power', 'toughness', 'token']) if (c[key] !== undefined) d[key] = c[key];
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
      case 'mana':
        fields(a, ['kind', 'produces'], path);
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
        fields(a, ['kind', 'target', 'effects'], path);
        spells++;
        d.target = a.target === undefined ? null : target(a.target, `${path}.target`);
        d.effects = effects(a.effects, `${path}.effects`);
        break;
      case 'activated':
        fields(a, ['kind', 'cost', 'target', 'effects', 'text'], path);
        (d.activated ??= []).push({
          cost: cost(a.cost, `${path}.cost`),
          ...(a.target !== undefined ? { target: target(a.target, `${path}.target`) } : {}),
          effects: effects(a.effects, `${path}.effects`),
          ...(a.text !== undefined ? { text: a.text } : {}),
        });
        break;
      case 'triggered': {
        fields(a, ['kind', 'on', 'optional', 'target', 'effects'], path);
        if (a.optional !== undefined && typeof a.optional !== 'boolean')
          problem('INVALID_OPTIONAL', path, 'Optional must be a boolean.');
        for (const error of validateEventSpec(a.on))
          problem('UNSUPPORTED_EVENT', `${path}.on`, error);
        const event =
          Object.keys(EVENTS).find((key) => same(EVENTS[key], a.on)) ?? structuredClone(a.on);
        const instructions = effects(a.effects, `${path}.effects`);
        if (event === 'selfEnters' && !a.optional && !a.target && !d.etb) d.etb = instructions;
        else
          (d.triggers ??= []).push({
            event,
            effects: instructions,
            ...(a.target !== undefined ? { target: target(a.target, `${path}.target`) } : {}),
            ...(a.optional !== undefined ? { optional: a.optional } : {}),
          });
        break;
      }
      case 'entry':
        fields(a, ['kind', 'tapped'], path);
        if (a.tapped !== true)
          problem('UNSUPPORTED_ENTRY', path, 'Only unconditional tapped entry is implemented.');
        if (d.entersTapped) problem('DUPLICATE_ENTRY', path, 'Entry replacement is repeated.');
        d.entersTapped = true;
        break;
      case 'anthem':
        fields(a, ['kind', 'power', 'toughness'], path);
        if (d.static)
          problem(
            'MULTIPLE_STATIC',
            path,
            'This profile supports one controller-wide creature anthem.',
          );
        d.static = { kind: 'anthem', power: a.power, toughness: a.toughness };
        break;
      case 'aura':
        fields(a, ['kind', 'enchant', 'restriction'], path);
        if (
          !same(a.enchant, targetSpec('creature')) ||
          a.restriction !== 'cantAttackOrBlock' ||
          d.aura
        )
          problem(
            'UNSUPPORTED_AURA',
            path,
            'This profile supports the creature combat-restriction aura only.',
          );
        d.aura = 'pacifism';
        d.target = 'creature';
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
