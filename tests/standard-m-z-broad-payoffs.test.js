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
  'Moonshaker Cavalry',
  'Plumecreed Mentor',
  'Starry-Eyed Skyrider',
  'Sagu Pummeler',
  'Shattered Wings',
  'Old Thrush',
  'Malamet Veteran',
  'Riftburst Hellion',
  'Stinging Cave Crawler',
  'Treeguard Duo',
  'Sahagin',
  'Teeming Dragonstorm',
  "Proctor's Gaze",
  'Your Fate Ends Here',
  'Mysidian Elder',
  'Skybeast Tracker',
  "Moogles' Valor",
  'White Soldier Token',
  'White Moogle Token',
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
test('17 additional Standard cards and two exact token sources compile and round trip every clause', () => {
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
test('Moonshaker counts itself and the whole team once, granting flying to each', () => {
  let s = fixture();
  const bear = put(s, 'Grizzly Bears');
  const cavalry = enter(s, 'Moonshaker Cavalry');
  s = resolve(s);
  assert.equal(stats(s, s.objects[cavalry.id]).power, 8);
  assert.equal(stats(s, s.objects[bear.id]).power, 4);
  assert(hasKeyword(s, s.objects[bear.id], 'flying'));
});
test('Sagu Pummeler renew is a sorcery-speed graveyard activation with both counter instructions', () => {
  let s = fixture();
  lands(s, 'Forest', 5);
  const source = put(s, 'Sagu Pummeler', 0, 'graveyard'),
    target = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
  assert.equal(s.objects[source.id].zone, 'exile');
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 2);
  assert(hasKeyword(s, s.objects[target.id], 'reach'));
});
test('Plumecreed Mentor targets a grounded creature on its own entry', () => {
  let s = fixture();
  const ally = put(s, 'Grizzly Bears');
  const mentor = enter(s, 'Plumecreed Mentor');
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.deepEqual(s.choice.targets, [ref(ally)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(ally) });
  s = resolve(s);
  assert.equal(s.objects[ally.id].plusCounters, 1);
  assert.equal(s.objects[mentor.id].plusCounters, 0);
});
test('Teeming Dragonstorm creates two exact 2/2 Soldiers and returns itself when a Dragon enters', () => {
  let s = fixture();
  const storm = enter(s, 'Teeming Dragonstorm');
  s = resolve(s);
  const soldiers = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'White Soldier Token',
  );
  assert.equal(soldiers.length, 2);
  assert(soldiers.every((o) => stats(s, o).power === 2 && stats(s, o).toughness === 2));
  enter(s, 'Shivan Dragon');
  s = resolve(s);
  assert.equal(s.objects[storm.id].zone, 'hand');
});
test('Skybeast Tracker includes X in the spell mana value, not extra costs', () => {
  for (const x of [2, 3]) {
    let s = fixture();
    lands(s, 'Island', 5);
    put(s, 'Skybeast Tracker');
    const spell = put(s, 'Mind Spring', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, x });
    if (x === 3) s = resolve(s);
    assert.equal(
      Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Food Token')
        .length,
      x === 3 ? 1 : 0,
    );
  }
});
test('Old Thrush search puts the chosen land above the shuffled library and gains two life', () => {
  let s = fixture();
  enter(s, 'Old Thrush');
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.optional, true);
  const id = s.choice.cards[0];
  s = act(s, 'searchLibrary', { cards: [id] });
  assert.equal(s.players[0].library[0], id);
});
test('Proctor Gaze can decline the bounce target while retaining its independent land search', () => {
  let s = fixture();
  lands(s, 'Forest', 3);
  lands(s, 'Island', 1);
  const spell = put(s, "Proctor's Gaze", 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [] } });
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  const id = s.choice.cards[0];
  s = act(s, 'searchLibrary', { cards: [id] });
  assert.equal(s.objects[id].zone, 'battlefield');
  assert(s.objects[id].tapped);
});
test('Moogles Valor counts existing creatures before token creation and protects the entire resulting team', () => {
  let s = fixture();
  lands(s, 'Plains', 6);
  put(s, 'Grizzly Bears');
  const spell = put(s, "Moogles' Valor", 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  const creatures = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'White Moogle Token',
  );
  assert.equal(creatures.length, 1);
  assert(hasKeyword(s, creatures[0], 'lifelink'));
  assert(hasKeyword(s, creatures[0], 'indestructible'));
  assert.equal(stats(s, creatures[0]).toughness, 2);
});
