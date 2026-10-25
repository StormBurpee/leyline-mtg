import { CARDS } from '../packages/engine/src/cards.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
// Explicit maintenance command. Never called by the rules engine or at startup.
let result = {};
try {
  result = JSON.parse(
    await readFile(new URL('../apps/web/card-metadata.json', import.meta.url), 'utf8'),
  );
} catch {}
for (const card of Object.values(CARDS).filter((c) => !c.token)) {
  if (result[card.name]) continue;
  const response = await fetch(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.name)}`,
    {
      headers: {
        'User-Agent': 'LeylineMTG/0.1 (open-source fan client)',
        Accept: 'application/json',
      },
    },
  );
  if (!response.ok) throw new Error(`${card.name}: ${response.status}`);
  const d = await response.json();
  result[card.name] = {
    id: d.id,
    oracle_id: d.oracle_id,
    name: d.name,
    mana_cost: d.mana_cost,
    type_line: d.type_line,
    oracle_text: d.oracle_text,
    artist: d.artist,
    image: d.image_uris?.normal,
    art: d.image_uris?.art_crop,
    scryfall_uri: d.scryfall_uri,
  };
  await writeFile(
    new URL('../apps/web/card-metadata.json', import.meta.url),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(card.name);
  await new Promise((r) => setTimeout(r, 1600));
}
await mkdir(new URL('../apps/web/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../apps/web/card-metadata.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n',
);
