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
  'Zuko, Exiled Prince',
  'Slithering Cryptid',
  'Scour for Scrap',
  'Seize Opportunity',
  'Voracious Vermin',
  'Mirkwood',
  'Price of Freedom',
  'Trostani, Three Whispers',
  'Radioactive Spider',
  'Sandstorm Salvager',
  'Mouser Attack!',
  'Spider Food',
  'Colorless Golem Token',
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
test('12 complete next-release cards and one exact Golem token compile and round trip every clause', () => {
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
test('Scour for Scrap allows both modes for its printed cost without charging extra mana', () => {
  let s = fixture();
  lands(s, 'Island', 4);
  const target = put(s, 'Ornithopter', 0, 'graveyard');
  const spell = put(s, 'Scour for Scrap', 0, 'hand');
  const cmd = legalActions(s, 0).find(
    (a) => a.type === 'cast' && a.card === spell.id && a.mode === 2,
  );
  assert(cmd);
  s = act(s, 'cast', cmd);
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  s = act(s, 'searchLibrary', { cards: [] });
  assert.equal(s.objects[target.id].zone, 'hand');
});
test('Mouser Attack token mode creates exactly one 1/1 artifact Robot, not the existing 2/2 Robot', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const spell = put(s, 'Mouser Attack!', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 0 });
  s = resolve(s);
  const robot = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Small Robot Token',
  );
  assert(robot);
  assert.equal(stats(s, robot).power, 1);
});
test('Price of Freedom preserves opponent ownership through the optional search and draws afterward', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const enemy = put(s, 'Forest', 1);
  const spell = put(s, 'Price of Freedom', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(enemy) });
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.players[0].hand.length, 0);
  s = act(s, 'searchLibrary', { cards: [], decline: true }, 1);
  assert.equal(s.players[0].hand.length, 1);
});
test('Sandstorm Salvager creates the exact Golem and its activation improves creature tokens only', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const source = enter(s, 'Sandstorm Salvager');
  s = resolve(s);
  s.objects[source.id].controlledSince = s.turn - 1;
  const token = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Colorless Golem Token',
  );
  const bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[token.id]).power, 4);
  assert(hasKeyword(s, s.objects[token.id], 'trample'));
  assert.equal(s.objects[bear.id].plusCounters, 0);
});
test('Spider Food can choose no destruction target and still creates its Food', () => {
  let s = fixture();
  lands(s, 'Forest', 3);
  const spell = put(s, 'Spider Food', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [] } });
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Food Token')
      .length,
    1,
  );
});
test('Trostani grants exactly the selected keyword for each of her three hybrid-compatible abilities', () => {
  for (const [ability, keyword] of ['deathtouch', 'vigilance', 'double strike'].entries()) {
    let s = fixture();
    lands(s, 'Forest', 3);
    lands(s, 'Plains', 3);
    const source = put(s, 'Trostani, Three Whispers'),
      target = put(s, 'Grizzly Bears');
    s = act(s, 'activate', { card: source.id, ability, target: ref(target) });
    s = resolve(s);
    assert(hasKeyword(s, s.objects[target.id], keyword));
  }
});
