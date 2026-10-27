import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS, legalActions, ref, stats } from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = [
  'Meticulous Commons',
  'Stingerquill Annex',
  'Theorix Annex',
  'Transformative Commons',
  'Vigorbloom Annex',
  'Mox Jasper',
  'Storyteller Pixie',
  'Terminal Criticism',
  'Solarium Sentry',
  'Yuyan Archers',
  'Tweeze',
  'Sunset Strikemaster',
  'Mental Modulation',
  'Terror Tide',
  'Valley Mightcaller',
  'Mindful Biomancer',
  'Ouroboroid',
  'Road Rage',
  'The Spirit Oasis',
  "Valgavoth's Faithful",
  'Soured Springs',
  'Neighborhood Guardian',
  'Stromkirk Bloodthief',
  'Suspicious Shambler',
  'Volley Veteran',
  'Vicious Clown',
  'Marketwatch Phantom',
  'Yellowjacket, Heartless Marauder',
  'Seedpod Squire',
  'Sami, Wildcat Captain',
  'Veteran Beastrider',
  'Slash of Light',
  'Make a Stand',
  'Ray of Ruin',
  'Slumbering Keepguard',
  'Syr Vondam, the Lucent',
  'Training Compound',
  'Skulduggery',
  'Pactdoll Terror',
  'Null Group Biological Assets',
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
test('40 complete Standard M–Z sources compile and round trip every clause', () => {
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
import { move } from '../packages/engine/src/model.js';

test('five planeswalker lands enter untapped only with a controlled planeswalker', () => {
  for (const name of names.filter((n) => n.endsWith('Annex') || n.endsWith('Commons'))) {
    for (const owner of [null, 0, 1]) {
      let s = fixture();
      if (owner !== null) put(s, 'The Theorist, Jace Beleren', owner);
      const land = put(s, name, 0, 'hand');
      s = act(s, 'playLand', { card: land.id });
      assert.equal(s.objects[land.id].tapped, owner !== 0, name);
    }
  }
});
test('Terminal Criticism preserves color and type restrictions and gains life', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const blue = put(s, 'Tolarian Terror', 1);
  const green = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Terminal Criticism', 0, 'hand');
  const casts = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === spell.id);
  assert(casts.some((a) => a.target?.id === blue.id));
  assert(!casts.some((a) => a.target?.id === green.id));
  // A blue creature without ward avoids obscuring this removal's own resolution.
  const target = put(s, 'Storyteller Pixie', 1);
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 21);
});
test('Mental Modulation discounts only its controller turn and can tap a noncreature artifact', () => {
  for (const activePlayer of [0, 1]) {
    let s = fixture();
    s.active = activePlayer;
    lands(s, 'Island', 1);
    const target = put(s, 'Mox Jasper', 1);
    const spell = put(s, 'Mental Modulation', 0, 'hand');
    const available = legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id);
    assert.equal(available, activePlayer === 0);
    if (activePlayer === 0) {
      s = act(s, 'cast', { card: spell.id, target: ref(target) });
      s = resolve(s);
      assert(s.objects[target.id].tapped);
      assert.equal(s.players[0].hand.length, 1);
    }
  }
});
test('Ouroboroid snapshots its power once across the whole counter batch', () => {
  let s = fixture();
  const worm = put(s, 'Ouroboroid');
  const friend = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  s = resolve(s);
  assert.equal(s.step, 'beginCombat');
  s = resolve(s);
  assert.equal(s.objects[worm.id].plusCounters, 1);
  assert.equal(s.objects[friend.id].plusCounters, 1);
  assert.equal(s.objects[enemy.id].plusCounters, 0);
});
test('Valley Mightcaller grows for another matching subtype, not an opponent or itself', () => {
  let s = fixture();
  const source = put(s, 'Valley Mightcaller');
  const frog = put(s, 'Poison Dart Frog', 0, 'hand');
  enterBattlefield(s, frog, 0);
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 1);
  const enemy = put(s, 'Poison Dart Frog', 1, 'hand');
  enterBattlefield(s, enemy, 1);
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 1);
});
test('Valgavoth Faithful sacrifices as cost and returns the selected graveyard creature', () => {
  let s = fixture();
  lands(s, 'Swamp', 4);
  const priest = put(s, "Valgavoth's Faithful");
  const target = put(s, 'Grizzly Bears', 0, 'graveyard');
  s = act(s, 'activate', { card: priest.id, ability: 0, target: ref(target) });
  assert.equal(s.objects[priest.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
});
test('Suspicious Shambler graveyard activation exiles as a cost and creates exactly two zombies', () => {
  let s = fixture();
  lands(s, 'Swamp', 6);
  const source = put(s, 'Suspicious Shambler', 0, 'graveyard');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(s.objects[source.id].zone, 'exile');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Zombie Token')
      .length,
    2,
  );
});

test('Skulduggery resolves its remaining legal group after the enemy target leaves', () => {
  let s = fixture();
  lands(s, 'Swamp', 1);
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Skulduggery', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { friendly: [ref(own)], enemy: [ref(enemy)] } });
  move(s, s.objects[enemy.id], 'hand');
  s = resolve(s);
  assert.equal(stats(s, s.objects[own.id]).power, 3);
  assert.equal(stats(s, s.objects[own.id]).toughness, 3);
});
test('Pactdoll Terror triggers once for itself and once for another artifact, never twice', () => {
  let s = fixture();
  const terror = put(s, 'Pactdoll Terror', 0, 'hand');
  enterBattlefield(s, terror, 0);
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  const artifact = put(s, 'Ornithopter', 0, 'hand');
  enterBattlefield(s, artifact, 0);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});
test('Ray of Ruin targets nonbasic lands and Vehicles as well as creatures', () => {
  let s = fixture();
  lands(s, 'Swamp', 5);
  const spell = put(s, 'Ray of Ruin', 0, 'hand');
  const nonbasic = put(s, 'Soured Springs', 1);
  const basic = put(s, 'Forest', 1);
  const vehicle = put(s, "Cultivator's Caravan", 1);
  const targets = legalActions(s, 0)
    .filter((a) => a.type === 'cast' && a.card === spell.id)
    .map((a) => a.target?.id);
  assert(targets.includes(nonbasic.id));
  assert(targets.includes(vehicle.id));
  assert(!targets.includes(basic.id));
});
test('Mox Jasper only supplies mana while a Dragon is controlled', () => {
  for (const controller of [null, 0, 1]) {
    let s = fixture();
    put(s, 'Mox Jasper');
    if (controller !== null) put(s, 'Shivan Dragon', controller);
    const spell = put(s, 'Opt', 0, 'hand');
    assert.equal(
      legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id),
      controller === 0,
    );
  }
});
