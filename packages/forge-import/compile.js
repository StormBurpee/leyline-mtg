/**
 * Conservative Forge-script migration aid. Compiles a finite, explicit grammar
 * to executable-data candidates. It never evaluates Oracle prose or JavaScript.
 */
import { validateDefinition } from '../engine/src/registry.js';
const KEYWORDS = new Set([
  'flying',
  'reach',
  'haste',
  'vigilance',
  'trample',
  'deathtouch',
  'lifelink',
  'defender',
  'first strike',
  'double strike',
  'flash',
  'hexproof',
  'shroud',
  'indestructible',
]);
const BASIC_MANA = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const PRESENTATION = new Set([
  'Name',
  'ManaCost',
  'Types',
  'PT',
  'Oracle',
  'DeckHints',
  'DeckHas',
  'DeckNeeds',
]);
const OPERAND_FIELDS = {
  DealDamage: ['ValidTgts', 'NumDmg'],
  Counter: ['ValidTgts', 'TargetType'],
  Draw: ['NumCards', 'Defined'],
  Destroy: ['ValidTgts'],
  ChangeZone: ['ValidTgts', 'Origin', 'Destination'],
  Scry: ['ScryNum', 'Defined'],
  Surveil: ['Amount', 'Defined'],
  Discard: ['NumCards', 'Defined', 'Mode'],
  Pump: ['ValidTgts', 'Defined', 'NumAtt', 'NumDef', 'KW', 'Duration'],
};
function number(text, label, errors, { signed = false, fallback } = {}) {
  if (text === undefined && fallback !== undefined) return fallback;
  if (!(signed ? /^[+-]?\d+$/ : /^\d+$/).test(text ?? '')) {
    errors.push(`${label} must be a literal ${signed ? '' : 'nonnegative '}integer.`);
    return 0;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    errors.push(`${label} is outside the supported integer range.`);
    return 0;
  }
  return value;
}
function parseCost(text, errors) {
  const cost = {};
  if (text === 'no cost') return cost;
  for (const token of (text ?? '').trim().split(/\s+/)) {
    if (/^\d+$/.test(token))
      cost.generic = (cost.generic ?? 0) + number(token, 'Mana cost', errors);
    else if (/^[WUBRGC]$/.test(token)) cost[token] = (cost[token] ?? 0) + 1;
    else errors.push(`Unsupported mana symbol: ${token || '(empty)'}`);
  }
  if (Object.values(cost).some((n) => !Number.isSafeInteger(n)))
    errors.push('Mana cost exceeds the supported integer range.');
  return cost;
}
function fields(text, errors) {
  const out = Object.create(null);
  for (const segment of text.split('|')) {
    const match = segment.trim().match(/^([^$]+)\$\s*(.*)$/);
    if (!match) {
      errors.push(`Malformed ability field: ${segment.trim()}`);
      continue;
    }
    const key = match[1].trim();
    if (Object.hasOwn(out, key)) errors.push(`Duplicate ability field: ${key}`);
    out[key] = match[2].trim();
  }
  return out;
}
function targetFor(a, errors) {
  const target =
    a.ValidTgts === 'Any'
      ? 'any'
      : a.ValidTgts === 'Creature'
        ? 'creature'
        : a.TargetType === 'Spell' && a.ValidTgts === 'Card'
          ? 'spell'
          : null;
  if (a.ValidTgts && !target) errors.push(`Unsupported target predicate: ${a.ValidTgts}`);
  return target;
}
function compileInstruction(a, context) {
  const { errors, rootKind, sub } = context;
  const tags = ['SP', 'AB', 'DB'].filter((k) => Object.hasOwn(a, k));
  if (tags.length !== 1) {
    errors.push('Expected exactly one SP, AB or DB opcode marker.');
    return { effects: [] };
  }
  const tag = tags[0],
    opcode = a[tag];
  if (sub && tag !== 'DB') errors.push('SubAbility references must point to a DB instruction.');
  const operands = OPERAND_FIELDS[opcode];
  if (!operands) {
    errors.push(`Unsupported ${tag === 'AB' ? 'ability' : 'spell'} opcode: ${opcode}`);
    return { effects: [] };
  }
  const allowed = new Set([
    tag,
    'SpellDescription',
    'TgtPrompt',
    'SubAbility',
    ...(!sub && tag === 'AB' ? ['Cost'] : []),
    ...operands,
  ]);
  for (const key of Object.keys(a))
    if (!allowed.has(key)) errors.push(`Unsupported spell field: ${key}`);
  if (sub && (a.ValidTgts || a.TargetType))
    errors.push('A subability cannot introduce a new target in this subset.');
  const target = targetFor(a, errors);
  if (
    ['Draw', 'Scry', 'Surveil', 'Discard'].includes(opcode) &&
    a.Defined !== undefined &&
    a.Defined !== 'You'
  )
    errors.push(`${opcode}: only Defined You is supported.`);
  switch (opcode) {
    case 'DealDamage':
      if (!target) errors.push('DealDamage requires a supported target predicate.');
      return { target, effects: [{ op: 'damage', amount: number(a.NumDmg, 'NumDmg', errors) }] };
    case 'Counter':
      if (target !== 'spell') errors.push('Counter requires TargetType Spell and ValidTgts Card.');
      return { target, effects: [{ op: 'counter' }] };
    case 'Draw':
      return {
        effects: [{ op: 'draw', count: number(a.NumCards, 'NumCards', errors, { fallback: 1 }) }],
      };
    case 'Scry':
      return {
        effects: [{ op: 'scry', count: number(a.ScryNum, 'ScryNum', errors, { fallback: 1 }) }],
      };
    case 'Surveil':
      return {
        effects: [{ op: 'surveil', count: number(a.Amount, 'Amount', errors, { fallback: 1 }) }],
      };
    case 'Discard':
      if (a.Mode !== undefined && a.Mode !== 'TgtChoose')
        errors.push('Only a player choosing their own discard is supported.');
      return {
        effects: [
          { op: 'discard', count: number(a.NumCards, 'NumCards', errors, { fallback: 1 }) },
        ],
      };
    case 'Destroy':
      if (target !== 'creature') errors.push('Destroy requires ValidTgts Creature in this subset.');
      return { target, effects: [{ op: 'destroy' }] };
    case 'ChangeZone':
      if (target !== 'creature' || a.Origin !== 'Battlefield' || a.Destination !== 'Hand')
        errors.push('Only battlefield-creature-to-hand ChangeZone is supported.');
      return { target, effects: [{ op: 'bounce' }] };
    case 'Pump': {
      if (a.Duration !== undefined && a.Duration !== 'UntilEndOfTurn')
        errors.push('Only until-end-of-turn Pump duration is supported.');
      const self =
        !target && (a.Defined === 'Self' || (a.Defined === undefined && rootKind === 'AB'));
      if (a.Defined !== undefined && a.Defined !== 'Self')
        errors.push('Only Defined Self is supported for source pumps.');
      if (!self && target !== 'creature')
        errors.push('Pump needs a creature target or an activated source.');
      if (self && rootKind !== 'AB')
        errors.push('A spell cannot use this source-pump translation.');
      const keywords = a.KW ? a.KW.split(' & ').map((k) => k.trim().toLowerCase()) : [];
      if (keywords.some((k) => !KEYWORDS.has(k)))
        errors.push('Pump contains an unsupported keyword.');
      return {
        target,
        effects: [
          {
            op: 'modify',
            ...(self ? { subject: 'source' } : {}),
            power: number(a.NumAtt, 'NumAtt', errors, { signed: true, fallback: 0 }),
            toughness: number(a.NumDef, 'NumDef', errors, { signed: true, fallback: 0 }),
            ...(keywords.length ? { keywords } : {}),
          },
        ],
      };
    }
  }
}
function parseAbilityCost(text, errors) {
  if (typeof text !== 'string') {
    errors.push('Activated abilities require an explicit Cost.');
    return {};
  }
  const tokens = text.trim().split(/\s+/),
    taps = tokens.filter((t) => t === 'T').length;
  if (taps > 1) errors.push('Multiple tap-cost symbols are unsupported.');
  const mana = tokens.filter((t) => t !== 'T');
  return {
    ...(taps ? { tap: true } : {}),
    ...(mana.length ? { mana: parseCost(mana.join(' '), errors) } : {}),
  };
}
export function compileForgeCard(text, { source = 'unspecified' } = {}) {
  const errors = [],
    rows = [],
    symbols = new Map(),
    used = new Set();
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) {
      errors.push(`Line ${i + 1}: missing field separator.`);
      continue;
    }
    const key = line.slice(0, colon),
      value = line.slice(colon + 1);
    rows.push({ key, value, line: i + 1 });
    if (!PRESENTATION.has(key) && !['K', 'A', 'SVar'].includes(key))
      errors.push(`Line ${i + 1}: unsupported field ${key}.`);
    if (key === 'SVar') {
      const split = value.indexOf(':');
      if (split < 1) {
        errors.push(`Line ${i + 1}: malformed SVar.`);
        continue;
      }
      const name = value.slice(0, split);
      if (symbols.has(name)) errors.push(`Duplicate SVar: ${name}`);
      symbols.set(name, value.slice(split + 1));
    }
  }
  const one = (key) => {
    const matches = rows.filter((r) => r.key === key);
    if (matches.length !== 1) errors.push(`Expected exactly one ${key} field.`);
    return matches[0]?.value;
  };
  const name = one('Name'),
    mana = one('ManaCost'),
    types = one('Types');
  const tokens = (types ?? '').split(/\s+/),
    primary = tokens.filter((t) =>
      ['Creature', 'Instant', 'Sorcery', 'Land', 'Artifact', 'Enchantment'].includes(t),
    );
  if (primary.length !== 1 || !['Creature', 'Instant', 'Sorcery', 'Land'].includes(primary[0]))
    errors.push('Only single-type creatures, instants, sorceries and basic lands are supported.');
  if (tokens.some((t) => ['Legendary', 'Snow', 'World', 'Kindred'].includes(t)))
    errors.push('Unsupported supertype or card type.');
  const type = primary[0]?.toLowerCase(),
    definition = {
      name,
      type,
      cost: parseCost(mana, errors),
      keywords: [],
      subtypes: tokens.filter((t) => !primary.includes(t) && t !== 'Basic'),
      text: rows.find((r) => r.key === 'Oracle')?.value.replaceAll('\\n', '\n') ?? '',
    };
  if (type === 'land') {
    if (
      !tokens.includes('Basic') ||
      !BASIC_MANA[name] ||
      definition.subtypes.length !== 1 ||
      definition.subtypes[0] !== name
    )
      errors.push('Only the five named basic lands are supported.');
    if (mana !== 'no cost') errors.push('Basic lands must have no mana cost.');
    definition.basic = true;
    definition.mana = BASIC_MANA[name];
  } else if (mana === 'no cost')
    errors.push('No-cost nonland cards require separate casting rules.');
  if (type === 'creature') {
    const pt = one('PT')?.match(/^(\d+)\/(\d+)$/);
    if (!pt) errors.push('Power/toughness must be literal nonnegative integers.');
    else {
      definition.power = number(pt[1], 'Power', errors);
      definition.toughness = number(pt[2], 'Toughness', errors);
    }
  }
  for (const row of rows.filter((r) => r.key === 'K')) {
    const keyword = row.value.toLowerCase();
    if (KEYWORDS.has(keyword)) definition.keywords.push(keyword);
    else if (keyword === 'prowess')
      (definition.triggers ??= []).push({
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      });
    else errors.push(`Line ${row.line}: unsupported keyword ${row.value}.`);
  }
  const walk = (a, rootKind, chain = []) => {
    if (chain.length > 32) {
      errors.push('SubAbility chain exceeds 32 instructions.');
      return { effects: [] };
    }
    const instruction = compileInstruction(a, { errors, rootKind, sub: chain.length > 0 });
    if (a.SubAbility) {
      const symbol = a.SubAbility;
      if (chain.includes(symbol)) {
        errors.push(`Cyclic SubAbility: ${symbol}`);
        return instruction;
      }
      if (!symbols.has(symbol)) {
        errors.push(`Missing SVar: ${symbol}`);
        return instruction;
      }
      used.add(symbol);
      const next = walk(fields(symbols.get(symbol), errors), rootKind, [...chain, symbol]);
      instruction.effects.push(...next.effects);
    }
    return instruction;
  };
  const abilities = rows.filter((r) => r.key === 'A').map((r) => fields(r.value, errors));
  if (['instant', 'sorcery'].includes(type)) {
    if (abilities.length !== 1 || !abilities[0]?.SP)
      errors.push('Exactly one SP spell ability is required; modal spells are not translated.');
    if (abilities[0]) Object.assign(definition, walk(abilities[0], 'SP'));
  } else
    for (const a of abilities) {
      if (!a.AB) {
        errors.push('Permanent abilities must use AB.');
        continue;
      }
      if (a.AB === 'Mana') {
        if (
          Object.keys(a).some((k) => !['AB', 'Cost', 'Produced', 'SpellDescription'].includes(k)) ||
          a.Cost !== 'T' ||
          !/^[WUBRGC]$/.test(a.Produced ?? '') ||
          definition.mana
        )
          errors.push('Only one tap ability producing a single mana is supported.');
        else definition.mana = a.Produced;
      } else {
        const result = walk(a, 'AB');
        (definition.activated ??= []).push({
          cost: parseAbilityCost(a.Cost, errors),
          ...result,
          text: a.SpellDescription ?? '',
        });
      }
    }
  for (const symbol of symbols.keys())
    if (!used.has(symbol)) errors.push(`Unreferenced or unsupported SVar: ${symbol}`);
  if (type !== 'creature' && rows.some((r) => r.key === 'PT'))
    errors.push('Unexpected PT on a noncreature.');
  if (type !== 'creature' && rows.some((r) => r.key === 'K'))
    errors.push('Keywords on noncreatures require manual review.');
  if (!errors.length) errors.push(...validateDefinition(definition));
  return errors.length
    ? {
        status: 'unsupported',
        name: name ?? null,
        source,
        diagnostics: [...new Set(errors)],
        definition: null,
      }
    : { status: 'candidate', name, source, diagnostics: [], definition };
}
