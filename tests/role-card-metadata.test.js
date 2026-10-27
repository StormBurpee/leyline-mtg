import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';

const files = [
  'become-brutes',
  'besotted-knight-betroth-the-beast',
  'charmed-clothier',
  'charming-scoundrel',
  'conceited-witch-price-of-beauty',
  'cursed-courtier',
  'cut-in',
  'diminisher-witch',
  'embereth-veteran',
  'ferocious-werefox-guard-change',
  'hunter-s-axe',
  'living-lectern',
  'not-dead-after-all',
  'protective-parents',
  'redtooth-genealogist',
  'return-triumphant',
  'royal-treatment',
  'shatter-the-oath',
  'spiteful-hexmage',
  'splashy-spellcaster',
  'the-witch-s-vanity',
  'witch-s-mark',
];

test('all 22 admitted Role/grant cards retain exact reviewed identity, full face text, costs and readable metadata', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../apps/web/card-metadata.json', import.meta.url)),
  );
  const identities = new Set();
  for (const file of files) {
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${file}.json`, import.meta.url)),
    );
    const adventure = source.abilities.find((a) => a.kind === 'adventure');
    assert.equal(CARD_IDS[source.id], source.name);
    assert.ok(CARDS[source.name] && !CARDS[source.name].token);
    assert.equal(metadata[source.name].oracle_id, source.id);
    assert.ok(metadata[source.name].image, `${source.name}: main card image`);
    identities.add(source.id);
    for (const [face, name] of [
      [source, adventure?.mainName ?? source.name],
      ...(adventure ? [[adventure.spell, adventure.spell.name]] : []),
    ]) {
      const display = metadata[name];
      assert.ok(display?.image, `${name}: readable image`);
      assert.equal(face.rulesText, display.oracle_text, `${name}: complete Oracle clauses`);
      assert.equal(face.characteristics.manaCost, display.mana_cost, `${name}: mana cost`);
      for (const stat of ['power', 'toughness'])
        if (face.characteristics[stat] !== undefined)
          assert.equal(
            String(face.characteristics[stat]),
            String(display[stat]),
            `${name}: ${stat}`,
          );
    }
  }
  assert.equal(identities.size, 22);
});
