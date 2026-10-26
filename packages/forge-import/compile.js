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
  'menace',
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
  DealDamage: ['ValidTgts', 'NumDmg', 'Defined'],
  Counter: ['ValidTgts', 'TargetType'],
  GainLife: ['Defined', 'LifeAmount'],
  Mill: ['Defined', 'NumCards', 'ValidTgts'],
  PutCounter: ['Defined', 'CounterType', 'CounterNum'],
  Untap: ['Defined'],
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
      : a.ValidTgts === 'Player'
        ? 'player'
        : a.ValidTgts === 'Opponent'
          ? 'opponent'
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
  if (!Array.isArray(operands)) {
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
      if (a.Defined === 'Player.Opponent' && !target)
        return { effects: [{ op: 'damageOpponent', amount: number(a.NumDmg, 'NumDmg', errors) }] };
      if (a.Defined !== undefined)
        errors.push('Only untargeted Defined Player.Opponent damage is supported.');
      if (!target) errors.push('DealDamage requires a supported target predicate.');
      return { target, effects: [{ op: 'damage', amount: number(a.NumDmg, 'NumDmg', errors) }] };
    case 'Counter':
      if (target !== 'spell') errors.push('Counter requires TargetType Spell and ValidTgts Card.');
      return { target, effects: [{ op: 'counter' }] };
    case 'GainLife':
      if (a.Defined !== undefined && a.Defined !== 'You')
        errors.push('GainLife requires Defined You.');
      return { effects: [{ op: 'gainLife', amount: number(a.LifeAmount, 'LifeAmount', errors) }] };
    case 'Mill': {
      if (target && (!['player', 'opponent'].includes(target) || a.Defined !== undefined))
        errors.push('Unsupported mill target/Defined combination.');
      if (!target && a.Defined !== undefined && !['You', 'Player.Opponent'].includes(a.Defined))
        errors.push('Unsupported mill player selector.');
      return {
        target,
        effects: [
          {
            op: 'mill',
            count: number(a.NumCards, 'NumCards', errors, { fallback: 1 }),
            player: target ? 'target' : a.Defined === 'Player.Opponent' ? 'opponent' : 'controller',
          },
        ],
      };
    }
    case 'PutCounter':
      if (a.Defined !== 'Self' || a.CounterType !== 'P1P1' || !['AB', 'TR'].includes(rootKind))
        errors.push('Only source +1/+1 counters on abilities are supported.');
      return {
        effects: [
          {
            op: 'counterOn',
            subject: 'source',
            amount: number(a.CounterNum, 'CounterNum', errors),
          },
        ],
      };
    case 'Untap':
      if (a.Defined !== 'Self' || !['AB', 'TR'].includes(rootKind))
        errors.push('Only a permanent ability untapping its source is supported.');
      return { effects: [{ op: 'untap', subject: 'source' }] };
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
      if (self && !['AB', 'TR'].includes(rootKind))
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
  const life = tokens.filter((t) => /^PayLife<\d+>$/.test(t));
  if (life.length > 1) errors.push('Multiple life-cost terms require manual migration.');
  const mana = tokens.filter((t) => t !== 'T' && !life.includes(t));
  return {
    ...(taps ? { tap: true } : {}),
    ...(life.length ? { life: number(life[0].slice(8, -1), 'Life cost', errors) } : {}),
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
    if (!PRESENTATION.has(key) && !['K', 'A', 'T', 'R', 'SVar'].includes(key))
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
    if (mana !== 'no cost') errors.push('Lands must have no mana cost.');
    if (tokens.includes('Basic')) {
      if (!BASIC_MANA[name] || definition.subtypes.length !== 1 || definition.subtypes[0] !== name)
        errors.push('Only the five named basic lands are supported.');
      definition.basic = true;
      definition.mana = BASIC_MANA[name];
    } else if (definition.subtypes.length)
      errors.push('Nonbasic land subtypes require intrinsic-ability support.');
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
    else if (row.value.startsWith('Ward:')) {
      if (definition.ward) errors.push('Multiple ward instances require manual migration.');
      definition.ward = parseAbilityCost(row.value.slice(5), errors);
    } else if (keyword === 'prowess')
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
        const produced = /^Combo ([WUBRGC](?: [WUBRGC]){1,5})$/.exec(a.Produced ?? '');
        const mana = produced ? produced[1].split(' ') : a.Produced;
        if (
          Object.keys(a).some((k) => !['AB', 'Cost', 'Produced', 'SpellDescription'].includes(k)) ||
          a.Cost !== 'T' ||
          (!produced && !/^[WUBRGC]$/.test(a.Produced ?? '')) ||
          definition.mana
        )
          errors.push('Only one tap ability producing one mana of a listed color is supported.');
        else definition.mana = mana;
      } else {
        const result = walk(a, 'AB');
        (definition.activated ??= []).push({
          cost: parseAbilityCost(a.Cost, errors),
          ...result,
          text: a.SpellDescription ?? '',
        });
      }
    }
  for (const row of rows.filter((r) => r.key === 'T')) {
    const trigger = fields(row.value, errors);
    const allowed = new Set([
      'Mode',
      'Origin',
      'Destination',
      'ValidCard',
      'TriggerZones',
      'Execute',
      'TriggerDescription',
      'ValidActivatingPlayer',
    ]);
    for (const key of Object.keys(trigger))
      if (!allowed.has(key)) errors.push(`Unsupported trigger field: ${key}`);
    let event;
    if (trigger.Mode === 'ChangesZone') {
      if (
        trigger.Destination !== 'Battlefield' ||
        (trigger.Origin !== undefined && trigger.Origin !== 'Any') ||
        trigger.ValidActivatingPlayer !== undefined
      )
        errors.push('Unsupported zone-change trigger restriction.');
      if (trigger.ValidCard === 'Card.Self') event = 'selfEnters';
      else if (trigger.ValidCard === 'Creature.Other') event = 'otherCreatureEnters';
      else if (trigger.ValidCard === 'Land.YouCtrl') event = 'controllerLandEnters';
      else errors.push(`Unsupported zone-change trigger predicate: ${trigger.ValidCard}`);
      if (
        trigger.TriggerZones !== 'Battlefield' &&
        !(event === 'selfEnters' && trigger.TriggerZones === undefined)
      )
        errors.push('Trigger must watch from the battlefield.');
    } else if (trigger.Mode === 'SpellCast') {
      if (
        trigger.ValidActivatingPlayer !== 'You' ||
        trigger.TriggerZones !== 'Battlefield' ||
        trigger.Origin !== undefined ||
        trigger.Destination !== undefined
      )
        errors.push('Unsupported spell-cast trigger restriction.');
      if (trigger.ValidCard === 'Card.nonCreature') event = 'controllerCastsNoncreature';
      else if (trigger.ValidCard === 'Instant,Sorcery') event = 'controllerCastsInstantOrSorcery';
      else errors.push(`Unsupported cast trigger predicate: ${trigger.ValidCard}`);
    } else errors.push(`Unsupported trigger mode: ${trigger.Mode}`);
    if (!trigger.Execute || !symbols.has(trigger.Execute)) {
      errors.push(`Missing trigger SVar: ${trigger.Execute}`);
      continue;
    }
    used.add(trigger.Execute);
    const result = walk(fields(symbols.get(trigger.Execute), errors), 'TR', [trigger.Execute]);
    if (result.target) errors.push('Targeted triggers require a target-choice implementation.');
    if (event) (definition.triggers ??= []).push({ event, effects: result.effects });
  }
  const replacements = rows.filter((r) => r.key === 'R');
  if (replacements.length > 1)
    errors.push('Multiple replacement effects require the general replacement pipeline.');
  for (const row of replacements) {
    const rule = fields(row.value, errors);
    const allowed = [
      'Event',
      'ValidCard',
      'Destination',
      'ReplacementResult',
      'ReplaceWith',
      'Description',
    ];
    if (
      Object.keys(rule).some((k) => !allowed.includes(k)) ||
      rule.Event !== 'Moved' ||
      rule.ValidCard !== 'Card.Self' ||
      rule.Destination !== 'Battlefield' ||
      rule.ReplacementResult !== 'Updated' ||
      !symbols.has(rule.ReplaceWith)
    ) {
      errors.push('Only an unconditional self enters-tapped replacement is supported.');
      continue;
    }
    const effect = fields(symbols.get(rule.ReplaceWith), errors);
    used.add(rule.ReplaceWith);
    if (
      Object.keys(effect).some((k) => !['DB', 'Defined', 'ETB'].includes(k)) ||
      effect.DB !== 'Tap' ||
      effect.Defined !== 'Self' ||
      effect.ETB !== 'True'
    )
      errors.push('Only the literal ETB tap instruction is supported.');
    else definition.entersTapped = true;
  }
  if (type === 'land' && !definition.mana)
    errors.push('This land subset requires an explicit supported mana ability.');
  for (const symbol of symbols.keys())
    if (
      !used.has(symbol) &&
      !(
        symbol === 'BuffedBy' &&
        ['Land', 'Creature', 'Card.nonCreature'].includes(symbols.get(symbol))
      )
    )
      errors.push(`Unreferenced or unsupported SVar: ${symbol}`);
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
