import { CARDS, VERSION } from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
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
        ...new Set(
          [
            ...(c.effects ?? []),
            ...(c.etb ?? []),
            ...(c.triggers ?? []).flatMap((t) => t.effects),
            ...(c.activated ?? []).flatMap((a) => a.effects),
          ].map((e) => e.op),
        ),
      ],
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
