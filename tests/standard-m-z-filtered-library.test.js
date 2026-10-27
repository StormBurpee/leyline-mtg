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
  'Pictures of Spider-Man',
  'Master Piandao',
  'Orazca Puzzle-Door',
  "Rakshasa's Bargain",
  'Resentful Revelation',
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
          `../packages/cards/cards/${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('5 complete v54 filtered-library cards compile and round trip every clause', () => {
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
import { enterBattlefieldBatch, stabilize } from '../packages/engine/src/effects.js';
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
import { notifyTriggers } from '../packages/engine/src/model.js';
import { move } from '../packages/engine/src/model.js';
function deck(s, names) {
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'exile');
  return names.map((n) => put(s, n, 0, 'library'));
}
function select(s, top) {
  return act(s, 'orderLibrary', { top, rest: s.choice.cards.filter((id) => !top.includes(id)) });
}
test('Pictures of Spider-Man reveals up to two creatures and rejects noncreatures', () => {
  let s = fixture();
  deck(s, ['Forest', 'Grizzly Bears', 'Opt', 'Llanowar Elves', 'Island']);
  enter(s, 'Pictures of Spider-Man');
  s = resolve(s);
  assert.equal(s.choice.eligibleCards.length, 2);
  assert.throws(() => select(s, [s.choice.cards[0]]));
  const chosen = [...s.choice.eligibleCards];
  s = select(s, chosen);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.players[0].library.length, 3);
  assert.deepEqual(s.events.findLast((e) => e.type === 'lookChooseHand').revealed, [
    'Grizzly Bears',
    'Llanowar Elves',
  ]);
});
test('Master Piandao accepts Ally, Equipment and Lesson, or voluntarily chooses none', () => {
  let s = fixture();
  deck(s, ['Changeling Wayfinder', 'Super Suit', 'Accumulate Wisdom', 'Forest']);
  const master = put(s, 'Master Piandao');
  notifyTriggers(s, 'attack', { object: master, controller: 0 });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.eligibleCards.length, 3);
  s = select(s, []);
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.players[0].library.length, 4);
});
test('Orazca Puzzle-Door sacrifices then puts the unselected card into graveyard, not bottom', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  deck(s, ['Opt', 'Forest']);
  const door = put(s, 'Orazca Puzzle-Door');
  s = act(s, 'activate', { card: door.id, ability: 0 });
  assert.equal(s.objects[door.id].zone, 'graveyard');
  s = resolve(s);
  const [chosen, rest] = s.choice.cards;
  s = select(s, [chosen]);
  assert.equal(s.objects[chosen].zone, 'hand');
  assert.equal(s.objects[rest].zone, 'graveyard');
  assert.equal(s.players[0].library.length, 0);
});
test('Rakshasa’s Bargain mandates two hand selections and puts the other two into graveyard', () => {
  let s = fixture();
  for (const b of ['Forest', 'Island', 'Swamp']) lands(s, b, 2);
  deck(s, ['Opt', 'Forest', 'Grizzly Bears', 'Island']);
  const card = put(s, "Rakshasa's Bargain", 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.throws(() => select(s, []));
  const chosen = s.choice.cards.slice(0, 2),
    rest = s.choice.cards.slice(2);
  s = select(s, chosen);
  assert(chosen.every((id) => s.objects[id].zone === 'hand'));
  assert(rest.every((id) => s.objects[id].zone === 'graveyard'));
});
test('Resentful Revelation flashback keeps one card, buries two and exiles the spell', () => {
  let s = fixture();
  lands(s, 'Swamp', 7);
  deck(s, ['Opt', 'Forest', 'Grizzly Bears']);
  const card = put(s, 'Resentful Revelation', 0, 'graveyard');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  const chosen = s.choice.cards[0],
    rest = s.choice.cards.slice(1);
  s = select(s, [chosen]);
  assert.equal(s.objects[card.id].zone, 'exile');
  assert.equal(s.objects[chosen].zone, 'hand');
  assert(rest.every((id) => s.objects[id].zone === 'graveyard'));
});
