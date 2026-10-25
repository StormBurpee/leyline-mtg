/**
 * Conservative Forge-script migration aid. This compiles a deliberately small
 * grammar to reviewable candidate definitions. It does not execute scripts,
 * interpret Oracle prose, or register cards in a live game.
 */
const SIMPLE_KEYWORDS = new Set([
  'Flying',
  'Reach',
  'Haste',
  'Vigilance',
  'Trample',
  'Deathtouch',
  'Lifelink',
  'Defender',
  'First Strike',
  'Double Strike',
  'Flash',
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
function integer(text, label, errors) {
  if (!/^\d+$/.test(text ?? '')) {
    errors.push(`${label} must be a literal nonnegative integer.`);
    return null;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    errors.push(`${label} is outside the supported integer range.`);
    return null;
  }
  return value;
}
function parseCost(text, errors) {
  const cost = {};
  if (text === 'no cost') return cost;
  for (const token of (text ?? '').trim().split(/\s+/)) {
    if (/^\d+$/.test(token)) {
      const n = integer(token, 'Mana cost', errors);
      if (n !== null) cost.generic = (cost.generic ?? 0) + n;
    } else if (/^[WUBRGC]$/.test(token)) cost[token] = (cost[token] ?? 0) + 1;
    else errors.push(`Unsupported mana symbol: ${token || '(empty)'}`);
  }
  return cost;
}
function fields(text, errors) {
  const out = {};
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
function compileSpell(a, errors) {
  const allowedByOpcode = {
    DealDamage: ['ValidTgts', 'NumDmg'],
    Counter: ['ValidTgts', 'TargetType'],
    Draw: ['NumCards'],
    Destroy: ['ValidTgts'],
    ChangeZone: ['ValidTgts', 'Origin', 'Destination'],
  };
  const allowed = new Set(['SP', 'SpellDescription', ...(allowedByOpcode[a.SP] ?? [])]);
  for (const key of Object.keys(a))
    if (!allowed.has(key)) errors.push(`Unsupported spell field: ${key}`);
  const target =
    a.ValidTgts === 'Any'
      ? 'any'
      : a.ValidTgts === 'Creature'
        ? 'creature'
        : a.TargetType === 'Spell' && a.ValidTgts === 'Card'
          ? 'spell'
          : null;
  if (a.ValidTgts && !target) errors.push(`Unsupported target predicate: ${a.ValidTgts}`);
  switch (a.SP) {
    case 'DealDamage':
      if (!target) errors.push('DealDamage requires a supported target predicate.');
      return { target, effects: [{ op: 'damage', amount: integer(a.NumDmg, 'NumDmg', errors) }] };
    case 'Counter':
      if (target !== 'spell') errors.push('Counter requires TargetType Spell and ValidTgts Card.');
      return { target, effects: [{ op: 'counter' }] };
    case 'Draw':
      if (target) errors.push('Targeted draw is outside this translation subset.');
      return { effects: [{ op: 'draw', count: integer(a.NumCards, 'NumCards', errors) }] };
    case 'Destroy':
      if (target !== 'creature') errors.push('Destroy requires ValidTgts Creature in this subset.');
      return { target, effects: [{ op: 'destroy' }] };
    case 'ChangeZone':
      if (target !== 'creature' || a.Origin !== 'Battlefield' || a.Destination !== 'Hand')
        errors.push('Only battlefield-creature-to-hand ChangeZone is supported.');
      return { target, effects: [{ op: 'bounce' }] };
    default:
      errors.push(`Unsupported spell opcode: ${a.SP ?? '(missing SP)'}`);
      return {};
  }
}
export function compileForgeCard(text, { source = 'unspecified' } = {}) {
  const errors = [],
    rows = [];
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
    if (!PRESENTATION.has(key) && !['K', 'A'].includes(key))
      errors.push(`Line ${i + 1}: unsupported field ${key}.`);
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
  const type = primary[0]?.toLowerCase();
  const definition = {
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
      definition.power = integer(pt[1], 'Power', errors);
      definition.toughness = integer(pt[2], 'Toughness', errors);
    }
  }
  for (const row of rows.filter((r) => r.key === 'K')) {
    if (SIMPLE_KEYWORDS.has(row.value)) definition.keywords.push(row.value.toLowerCase());
    else if (row.value === 'Prowess')
      (definition.triggers ??= []).push({
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      });
    else errors.push(`Line ${row.line}: unsupported keyword ${row.value}.`);
  }
  const abilities = rows.filter((r) => r.key === 'A');
  if (['instant', 'sorcery'].includes(type)) {
    if (abilities.length !== 1)
      errors.push(
        'Exactly one spell ability is required; modal and chained spells are not translated.',
      );
    if (abilities[0])
      Object.assign(definition, compileSpell(fields(abilities[0].value, errors), errors));
  } else if (abilities.length)
    errors.push('Activated abilities require manual migration in this subset.');
  if (type !== 'creature' && rows.some((r) => r.key === 'PT'))
    errors.push('Unexpected PT on a noncreature.');
  if (type !== 'creature' && rows.some((r) => r.key === 'K'))
    errors.push('Keywords on noncreatures require manual review.');
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
