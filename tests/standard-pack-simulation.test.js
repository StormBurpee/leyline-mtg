import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runEpisode } from '../packages/simulation/run.js';
const review = JSON.parse(
  await readFile(new URL('./fixtures/standard-reviewed-v09.json', import.meta.url), 'utf8'),
);
const basics = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const temples = {
  W: 'Temple of Enlightenment',
  U: 'Temple of Epiphany',
  B: 'Temple of Deceit',
  R: 'Temple of Abandon',
  G: 'Temple of Mystery',
};
function deck(color, offset = 0) {
  const cards = review.cards
    .map((c) => c.definition)
    .filter((d) => Object.keys(d.cost).every((k) => k === 'generic' || k === color));
  const creatures = cards.filter((d) => d.type === 'creature'),
    spells = cards.filter((d) => ['instant', 'sorcery'].includes(d.type));
  assert.ok(
    creatures.length >= 5 && spells.length >= 4,
    `${color}: enough distinct reviewed cards`,
  );
  return [
    ...Array(22).fill(basics[color]),
    ...Array(2).fill(temples[color]),
    ...Array.from({ length: 5 }, (_, i) =>
      Array(4).fill(creatures[(i + offset) % creatures.length].name),
    ).flat(),
    ...Array.from({ length: 4 }, (_, i) =>
      Array(4).fill(spells[(i + offset) % spells.length].name),
    ).flat(),
  ];
}
const colors = Object.keys(basics);
for (const [index, color] of colors.entries())
  test(`reviewed Standard ${color}/${colors[(index + 1) % colors.length]} decks complete through opaque policy observations`, async () => {
    const result = await runEpisode({
      config: {
        seed: 101 + index,
        decks: [deck(color, index), deck(colors[(index + 1) % colors.length], index + 2)],
      },
      maxDecisions: 6000,
    });
    assert.equal(result.termination, 'finished', JSON.stringify(result));
    assert.equal(result.status, 'finished');
    assert.equal(result.error, null);
  });
