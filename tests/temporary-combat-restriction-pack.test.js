import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS, replay, canBlock } from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createSession } from '../packages/simulation/session.js';
const names = [
  'Zog, Triceraton Castaway',
  'Clammy Prowler',
  'Goblin Smuggler',
  "Deserter's Disciple",
  'Eardrum Rattler',
  "Elvenking's Harper",
  'Enter the Enigma',
  'Duel Tactics',
  'Ragged Playmate',
  "Rogue's Passage",
  'Sandstorm Verge',
  'Sower of Chaos',
  'Summit Intimidator',
  'Apocalypse Runner',
  'Pym Particles',
  'Gateway Sneak',
  'Razzle-Dazzler',
  'Underfoot Underdogs',
  'Escape Tunnel',
  'War Squeak',
  'Gearseeker Serpent',
];
test('21 complete temporary restriction sources compile and round-trip without keyword invention', async () => {
  for (const name of names) {
    const filename = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${filename}.json`, import.meta.url)),
    );
    const first = compileCard(source, { identities: CARD_IDS });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = compileCard(
      sourceFromDefinition(first.definition, {
        id: source.id,
        idsByName: Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id])),
      }),
      { identities: CARD_IDS },
    );
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.deepEqual(second.definition, first.definition);
  }
});
test('opaque observations retain exact restriction references and replay reconstructs their legality', () => {
  const catalog = {
    ...CARDS,
    "Elvenking's Harper": { ...CARDS["Elvenking's Harper"], cost: {} },
    'Enter the Enigma': { ...CARDS['Enter the Enigma'], cost: {} },
  };
  let session;
  for (let seed = 1; seed < 200; seed++) {
    session = createSession({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(4).fill("Elvenking's Harper"),
          ...Array(4).fill('Enter the Enigma'),
          ...Array(52).fill('Island'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    const names = Object.values(session.context().observation.objects).map((o) => o.name);
    if (names.includes("Elvenking's Harper") && names.includes('Enter the Enigma')) break;
  }
  const step = (action) => {
    const c = session.context();
    const result = session.step({ ...action, player: c.player });
    assert.equal(result.ok, true, JSON.stringify(result));
  };
  while (session.context().observation.step !== 'main1') step({ type: 'pass' });
  let c = session.context();
  step(
    c.actions.find(
      (a) => a.type === 'cast' && c.observation.objects[a.card].name === "Elvenking's Harper",
    ),
  );
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  step(
    c.actions.find(
      (a) => a.type === 'cast' && c.observation.objects[a.card].name === 'Enter the Enigma',
    ),
  );
  step({ type: 'pass' });
  step({ type: 'pass' });
  const view = session.context().observation,
    modifier = view.modifiers.find((m) => m.combatRestriction === 'cannotBeBlocked');
  assert.ok(modifier);
  assert.match(modifier.objectId, /^object:/);
  const state = replay(session.exportReplay());
  assert.equal(state.modifiers.filter((m) => m.combatRestriction === 'cannotBeBlocked').length, 1);
  const target = Object.values(state.objects).find(
    (o) => o.zone === 'battlefield' && o.name === "Elvenking's Harper",
  );
  const virtualBlocker = { ...target, id: 'blocker', controller: 1, tapped: false };
  assert.equal(canBlock(state, virtualBlocker, target, 1), false);
  const visibleTarget = view.objects[modifier.objectId],
    visibleBlocker = { ...visibleTarget, id: 'blocker', controller: 1, tapped: false };
  assert.equal(canBlock(view, visibleBlocker, visibleTarget, 1), false);
});
