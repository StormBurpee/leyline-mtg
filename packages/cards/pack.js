import { jsonDataProblem } from './json-data.js';
import { compileCard } from './compiler.js';
/** A pack is all-or-nothing. No card silently disappears after a failed compilation. */
export function compilePack(cards, { mechanics = {} } = {}) {
  const diagnostics = [],
    names = new Set(),
    ids = new Set(),
    identities = Object.create(null),
    definitions = [],
    index = {};
  if (!Array.isArray(cards) || cards.length > 50000)
    return {
      ok: false,
      diagnostics: [
        { code: 'PACK_LIMIT', path: 'cards', message: 'Expected at most 50,000 card records.' },
      ],
    };
  if (jsonDataProblem(mechanics))
    return {
      ok: false,
      diagnostics: [
        {
          code: 'INVALID_MECHANICS',
          path: 'mechanics',
          message: 'Mechanics must be bounded JSON data.',
        },
      ],
    };
  if (Object.values(Object.getOwnPropertyDescriptors(cards)).some((d) => d.get || d.set))
    return {
      ok: false,
      diagnostics: [
        {
          code: 'INVALID_JSON_DATA',
          path: 'cards',
          message: 'Card arrays cannot contain accessors.',
        },
      ],
    };
  for (const [i, card] of cards.entries()) {
    const invalid = jsonDataProblem(card);
    if (invalid) {
      diagnostics.push({ code: 'INVALID_JSON_DATA', path: `cards[${i}]`, message: invalid });
      continue;
    }
    if (
      !card ||
      typeof card !== 'object' ||
      typeof card.id !== 'string' ||
      typeof card.name !== 'string'
    ) {
      diagnostics.push({
        code: 'INVALID_CARD',
        path: `cards[${i}]`,
        message: 'Expected a card object.',
      });
      continue;
    }
    if (names.has(card.name))
      diagnostics.push({
        code: 'DUPLICATE_NAME',
        path: `cards[${i}].name`,
        message: 'Card names must be unique.',
      });
    if (ids.has(card.id))
      diagnostics.push({
        code: 'DUPLICATE_ID',
        path: `cards[${i}].id`,
        message: 'Card identities must be unique.',
      });
    names.add(card.name);
    ids.add(card.id);
    identities[card.id] = card.name;
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  for (const card of cards) {
    const result = compileCard(card, { mechanics, identities });
    if (!result.ok)
      diagnostics.push(
        ...result.diagnostics.map((d) => ({ ...d, path: `${card.name}.${d.path}` })),
      );
    else {
      definitions.push(result.definition);
      index[result.id] = card.name;
    }
  }
  const byName = Object.fromEntries(definitions.map((d) => [d.name, d]));
  for (const d of definitions)
    for (const e of [
      ...(d.effects ?? []),
      ...(d.modes ?? []).flatMap((mode) => mode.effects),
      ...(d.etb ?? []),
      ...(d.triggers ?? []).flatMap((t) => t.effects),
      ...(d.activated ?? []).flatMap((a) => a.effects),
    ])
      if (['token', 'mobilize'].includes(e.op) && !byName[e.definition]?.token)
        diagnostics.push({
          code: 'TOKEN_REFERENCE',
          path: d.name,
          message: `${e.definition} is not a token definition.`,
        });
      else if (
        e.op === 'mobilize' &&
        (byName[e.definition].type !== 'creature' ||
          byName[e.definition].chooseCreatureType ||
          byName[e.definition].aura)
      )
        diagnostics.push({
          code: 'MOBILIZE_TOKEN',
          path: d.name,
          message: 'Mobilize requires a creature token without entry choices.',
        });
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, definitions, index, diagnostics: [] };
}
