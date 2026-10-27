import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  legalActions,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = [
  'Razorkin Hordecaller',
  'Wingblade Disciple',
  'Queen Brahne',
  'Rat Out',
  "The Crystal's Chosen",
  'Worthy Cost',
  'Splatter Technique',
  "Mabel's Mettle",
  'Most Valuable Slayer',
  'Rakish Crew',
  'Sunstar Expansionist',
  'Predictive Preparations',
  'Shipwreck Dowser',
  'Mystical Teachings',
  'Wojek Investigator',
  'Wayspeaker Bodyguard',
  'Red Gremlin Token',
  'White Flying Bird Token',
  'Black Wizard Spellslinger Token',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('16 Standard cards and three exact token sources compile and round trip every clause', () => {
  for (const source of sources) {
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[source.name]);
    assert.equal(compiled.definition.text, source.rulesText);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, source.name + JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});

import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefield } from '../packages/engine/src/effects.js';
test('Hordecaller creates one Gremlin per attacking group even when it stays home', () => {
  let s = fixture();
  const source = put(s, 'Razorkin Hordecaller');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.name === 'Red Gremlin Token',
    ).length,
    1,
  );
  assert(!s.objects[source.id].tapped);
});
test('Queen Brahne creates the exact Wizard that damages opponents on a noncreature cast', () => {
  let s = fixture();
  lands(s, 'Swamp', 1);
  const queen = put(s, 'Queen Brahne');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [queen.id] });
  s = resolve(s);
  const wizard = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Black Wizard Spellslinger Token',
  );
  assert(wizard);
  assert.equal(stats(s, wizard).power, 0);
  const spell = put(s, 'Rat Out', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [] } });
  // Resolve both the Wizard's damage trigger and Queen's prowess trigger, preserving the spell.
  if (s.choice?.kind === 'orderTriggers')
    s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  assert.equal(stats(s, s.objects[queen.id]).power, 3);
});
test('Rat Out supports zero targets and does not manufacture a blocking-capable Rat', () => {
  let s = fixture();
  lands(s, 'Swamp', 1);
  const spell = put(s, 'Rat Out', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [] } });
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Nonblocking Rat Token',
  );
  assert(token);
  assert.equal(CARDS[token.name].cannotBlock, true);
});
test('Mabel Mettle keeps optional other-target exclusion and both bonuses', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  const spell = put(s, "Mabel's Mettle", 0, 'hand');
  const commands = legalActions(s, 0).filter((c) => c.type === 'cast' && c.card === spell.id);
  assert(commands.every((c) => !c.targets.second.some((r) => r.id === c.targets.first[0].id)));
  s = act(s, 'cast', { card: spell.id, targets: { first: [ref(a)], second: [ref(b)] } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[a.id]).power, 4);
  assert.equal(stats(s, s.objects[b.id]).power, 3);
});
test('Crystal Chosen creates four Heroes then puts counters on all your creatures', () => {
  let s = fixture();
  lands(s, 'Plains', 7);
  const bear = put(s, 'Grizzly Bears');
  const spell = put(s, "The Crystal's Chosen", 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  const tokens = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'Hero Token',
  );
  assert.equal(tokens.length, 4);
  assert(tokens.every((o) => stats(s, o).power === 2));
  assert.equal(s.objects[bear.id].plusCounters, 1);
});
test('Sunstar Expansionist checks the land deficit again at trigger resolution', () => {
  for (const stillBehind of [true, false]) {
    let s = fixture();
    lands(s, 'Forest', 1, 1);
    const source = put(s, 'Sunstar Expansionist', 0, 'hand');
    enterBattlefield(s, source, 0);
    if (!stillBehind) lands(s, 'Forest', 1);
    s = resolve(s);
    assert.equal(
      Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Lander Token')
        .length,
      stillBehind ? 1 : 0,
    );
  }
});
test('Mystical Teachings can search for a creature with flash without narrowing to instants', () => {
  let s = fixture();
  lands(s, 'Island', 4);
  const flash = put(s, 'Spectral Sailor', 0, 'library');
  const spell = put(s, 'Mystical Teachings', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert(s.choice.cards.includes(flash.id));
  s = act(s, 'searchLibrary', { cards: [flash.id] });
  assert.equal(s.objects[flash.id].zone, 'hand');
});
