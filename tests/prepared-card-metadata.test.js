import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS } from '../packages/engine/src/index.js';

test('every authored prepared creature and spell-copy name has readable card artwork', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../apps/web/card-metadata.json', import.meta.url)),
  );
  for (const card of Object.values(CARDS)) {
    if (!card.prepareSpell) continue;
    for (const name of [card.name, card.mainName, card.prepareSpell.name]) {
      assert.ok(metadata[name]?.image, `${name}: missing card image`);
      assert.ok(metadata[name]?.oracle_text, `${name}: missing readable rules`);
    }
  }
});
