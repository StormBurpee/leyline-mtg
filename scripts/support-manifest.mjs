import { CARDS, VERSION } from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
import { effectInstructions } from '../packages/engine/src/effect-tree.js';

function definitionEffects(card) {
  if (!card) return [];
  return [
    ...(card.effects ?? []),
    ...(card.modes ?? []).flatMap((mode) => mode.effects),
    ...(card.etb ?? []),
    ...(card.triggers ?? []).flatMap((trigger) => [
      ...(trigger.effects ?? []),
      ...(trigger.modes ?? []).flatMap((mode) => mode.effects),
    ]),
    ...(card.attachmentTriggers ?? []).flatMap((trigger) => trigger.effects),
    ...(card.activated ?? []).flatMap((ability) => ability.effects),
    ...definitionEffects(card.adventure),
    ...definitionEffects(card.prepareSpell),
    ...definitionEffects(card.backFace),
    ...definitionEffects(card.kicker),
    ...(card.gift ? [{ op: 'token', definition: card.gift.definition }, ...card.gift.effects] : []),
    ...(card.stationLevels ?? []).flatMap((level) => definitionEffects(level.grants)),
    ...(card.classLevels ?? []).flatMap((level) => definitionEffects(level.abilities)),
  ];
}

const manifest = {
  version: VERSION,
  rulesReference: '2026-09-25',
  cards: Object.values(CARDS)
    .filter((c) => !c.token)
    .map((c) => ({
      name: c.name,
      type: c.type,
      keywords: c.keywords,
      opcodes: [
        ...new Set([...effectInstructions(definitionEffects(c))].map((effect) => effect.op)),
      ],
      ...(c.station ? { station: true } : {}),
      ...(c.stationLevels
        ? {
            stationLevels: c.stationLevels.map((level) => ({
              threshold: level.threshold,
              ...(level.power !== undefined
                ? { power: level.power, toughness: level.toughness }
                : {}),
              grants: level.grants,
            })),
          }
        : {}),
      ...(c.classLevels ? { classLevels: c.classLevels } : {}),
      ...(c.ward ? { ward: c.ward } : {}),
      ...(c.modes ? { modes: c.modes.map((mode) => mode.label) } : {}),
      triggers: (c.triggers ?? []).map((t) => t.event),
      activatedAbilities: c.activated?.length ?? 0,
    })),
  tokens: Object.values(CARDS)
    .filter((c) => c.token)
    .map((c) => c.name),
};
await writeFile(
  new URL('../docs/support.json', import.meta.url),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`${manifest.cards.length} cards; ${manifest.tokens.length} token definitions`);
