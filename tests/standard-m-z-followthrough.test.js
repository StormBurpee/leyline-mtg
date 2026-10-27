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
  'Saheeli, Jewel of Avishkar',
  'Uncle Iroh',
  'Slimy Dualleech',
  'Muse Seeker',
  'Mechan Assembler',
  'Scrap Compactor',
  'Take Out the Trash',
  'Xande, Dark Mage',
  'Wrath of the Bloodmane',
  'Roiling Dragonstorm',
  'Refute Destiny',
  "Rydia's Return",
  "Morcant's Loyalist",
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
test('13 additional Standard M–Z sources compile and round trip every clause', () => {
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
test('Saheeli gives only your Thopters haste and makes a flying artifact token for a noncreature cast', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  put(s, 'Saheeli, Jewel of Avishkar');
  const other = put(s, 'Flying Thopter Token', 1);
  const opt = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: opt.id, target: null });
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.controller === 0 && o.name === 'Flying Thopter Token',
  );
  assert(token);
  assert(hasKeyword(s, token, 'flying'));
  assert(hasKeyword(s, token, 'haste'));
  assert(!hasKeyword(s, s.objects[other.id], 'haste'));
});
test('Mechan Assembler makes one Robot for repeated artifact entries in the same turn', () => {
  let s = fixture();
  const source = put(s, 'Mechan Assembler');
  const first = put(s, 'Ornithopter', 0, 'hand');
  enterBattlefield(s, first, 0);
  s = resolve(s);
  const second = put(s, 'Ornithopter', 0, 'hand');
  enterBattlefield(s, second, 0);
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Robot Token')
      .length,
    1,
  );
});
test('Rydia return mode can return zero, one or two nonland or land permanent cards', () => {
  let s = fixture();
  lands(s, 'Forest', 5);
  const spell = put(s, "Rydia's Return", 0, 'hand');
  const land = put(s, 'Forest', 0, 'graveyard');
  const creature = put(s, 'Grizzly Bears', 0, 'graveyard');
  const choices = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === spell.id);
  const command = choices.find((a) => a.mode === 1 && a.targets?.chosen?.length === 2);
  assert(command);
  s = act(s, 'cast', command);
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'hand');
  assert.equal(s.objects[creature.id].zone, 'hand');
});
test('Scrap Compactor sacrifices as cost for either its damage or Vehicle removal activation', () => {
  for (const ability of [0, 1]) {
    let s = fixture();
    lands(s, 'Forest', 6);
    const source = put(s, 'Scrap Compactor');
    const target = put(s, ability === 0 ? 'Grizzly Bears' : "Cultivator's Caravan", 1);
    s = act(s, 'activate', { card: source.id, ability, target: ref(target) });
    assert.equal(s.objects[source.id].zone, 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'graveyard');
  }
});

test('Muse Seeker uses mana spent rather than printed mana value for Opus', () => {
  for (const reduced of [false, true]) {
    let s = fixture();
    lands(s, 'Island', 5);
    const muse = put(s, 'Muse Seeker');
    if (reduced) {
      put(s, 'Sami, Wildcat Captain');
      put(s, 'Ornithopter');
    }
    const spell = put(s, 'Ember Island Production', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, mode: 0, target: ref(muse) });
    s = resolve(s);
    if (reduced) assert.equal(s.choice?.kind, 'discardEffect');
    else assert.equal(s.choice, null);
  }
});
import { move } from '../packages/engine/src/model.js';
import { stabilize } from '../packages/engine/src/effects.js';
test('Morcant Loyalist excludes its own new graveyard incarnation but returns another Elf card', () => {
  let s = fixture();
  const source = put(s, "Morcant's Loyalist");
  const other = put(s, 'Llanowar Elves', 0, 'graveyard');
  const ally = put(s, 'Llanowar Elves');
  assert.equal(stats(s, ally).power, 2);
  assert.equal(stats(s, source).power, 3);
  move(s, source, 'graveyard');
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.deepEqual(s.choice.targets, [ref(other)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(other) });
  s = resolve(s);
  assert.equal(s.objects[other.id].zone, 'hand');
  assert.equal(s.objects[source.id].zone, 'graveyard');
});
