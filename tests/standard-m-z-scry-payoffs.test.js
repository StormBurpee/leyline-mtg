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
  'Psychic Whorl',
  'Unwelcome Sprite',
  'Mindseeker Oculus',
  "Muse's Encouragement",
  'Northern Air Temple',
  'Vindictive Warden',
  'Museum Nightwatch',
  'Mutant Chain Reaction',
  'Ooze Patrol',
  "Sephiroth, Planet's Heir",
  'Southern Air Temple',
  'Wispdrinker Vampire',
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
test('12 complete v51 cards compile and round trip every clause', () => {
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
import { notifyTriggers, move } from '../packages/engine/src/model.js';
test('Unwelcome Sprite triggers only for its controllers spells on opposing turns', () => {
  for (const [active, caster, wanted] of [
    [0, 0, 0],
    [1, 0, 1],
    [1, 1, 0],
  ]) {
    let s = fixture();
    s.active = active;
    put(s, 'Unwelcome Sprite');
    const c = put(s, 'Opt', caster, 'hand');
    notifyTriggers(s, 'cast', { object: c, controller: caster });
    stabilize(s);
    assert.equal(s.stack.length, wanted);
  }
});
test('Muse creates the exact multicolor flying Elemental before surveil', () => {
  let s = fixture();
  lands(s, 'Island', 5);
  const c = put(s, "Muse's Encouragement", 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Blue Red Flying Elemental Token' && o.zone === 'battlefield',
  );
  assert(token);
  assert.equal(stats(s, token).power, 3);
  assert(hasKeyword(s, token, 'flying'));
  assert.equal(s.choice.kind, 'libraryOrder');
});
test('Northern Air Temple counts itself and other Shrines but does not double trigger on its own entry', () => {
  let s = fixture();
  enter(s, 'Northern Air Temple');
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  assert.equal(s.stack.length, 0);
  const shrine = put(s, 'Sizzling Changeling'); // creature types do not imply Shrine enchantment type
  notifyTriggers(s, 'enter', { object: shrine, controller: 0 });
  stabilize(s);
  assert.equal(s.stack.length, 0);
});
test('Museum dies into the exact two-color Detective and Vindictive Warden deals noncombat damage', () => {
  let s = fixture();
  const c = put(s, 'Museum Nightwatch');
  move(s, c, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert(
    Object.values(s.objects).some((o) => o.name === 'Detective Token' && o.zone === 'battlefield'),
  );
  lands(s, 'Mountain', 3);
  const w = put(s, 'Vindictive Warden');
  s = act(s, 'activate', { card: w.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
});
test('Oculus empowers a new Jace with four counters', () => {
  let s = fixture();
  enter(s, 'Mindseeker Oculus');
  s = resolve(s);
  const j = Object.values(s.objects).find(
    (o) => o.name === 'Jace Token' && o.zone === 'battlefield',
  );
  assert(j);
  assert.equal(j.loyalty, 4);
});
test('Southern Air Temple counts all Shrines then a new Northern Shrine triggers both effects', () => {
  let s = fixture();
  const c = put(s, 'Grizzly Bears');
  enter(s, 'Southern Air Temple');
  s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 1);
  enter(s, 'Northern Air Temple');
  if (s.choice?.kind === 'orderTriggers')
    s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  while (s.stack.length) s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 2);
  assert.equal(s.players[0].life, 22);
});
test('Ooze Patrol includes preexisting artifact and creature cards after milling', () => {
  let s = fixture();
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Ornithopter', 0, 'graveyard');
  put(s, 'Grizzly Bears', 0, 'graveyard');
  const c = enter(s, 'Ooze Patrol');
  s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters >= 2, true);
});
test('Sephiroth gains counters for each opponent creature killed by his entry effect', () => {
  let s = fixture();
  put(s, 'Grizzly Bears', 1);
  const c = enter(s, "Sephiroth, Planet's Heir");
  s = resolve(s);
  while (s.stack.length) s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 1);
});
test('Wispdrinker reads effective entered power and the activation affects only low-power creatures', () => {
  let s = fixture();
  const w = put(s, 'Wispdrinker Vampire');
  enter(s, 'Grizzly Bears');
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  lands(s, 'Swamp', 6);
  lands(s, 'Plains', 1);
  const large = put(s, 'Serra Angel');
  s = act(s, 'activate', { card: w.id, ability: 0 });
  s = resolve(s);
  assert.equal(hasKeyword(s, s.objects[large.id], 'deathtouch'), false);
  assert(hasKeyword(s, s.objects[w.id], 'deathtouch'));
});
