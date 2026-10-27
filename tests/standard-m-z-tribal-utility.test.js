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
  'Pia, Determined Rebuilder',
  'Voja, Jaws of the Conclave',
  'Outcaster Greenblade',
  'Ticket Tortoise',
  'Nightdrinker Moroii',
  'Mudflat Village',
  "Sami's Curiosity",
  'Zhao, Ruthless Admiral',
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
test('8 complete next-release tribal and utility cards compile and round trip every clause', () => {
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
test('Voja counts Elves and Wolves separately at resolution, including itself as a Wolf', () => {
  let s = fixture();
  const v = put(s, 'Voja, Jaws of the Conclave');
  const e = put(s, 'Llanowar Elves');
  const b = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'attack', { object: v });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[v.id].plusCounters, 1);
  assert.equal(s.objects[e.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.equal(s.players[0].hand.length, 1);
});
test('Pia makes the exact flying Thopter and counts all controlled artifacts for the activated bonus', () => {
  let s = fixture();
  lands(s, 'Mountain', 6);
  const p = enter(s, 'Pia, Determined Rebuilder');
  s = resolve(s);
  const t = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Flying Thopter Token',
  );
  assert(t);
  put(s, 'Treasure Token');
  s = act(s, 'activate', { card: p.id, ability: 0, target: ref(t) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[t.id]).power, 3);
  assert(hasKeyword(s, s.objects[t.id], 'flying'));
});
test('Ticket Tortoise intervening-if rechecks the land deficit at resolution', () => {
  let s = fixture();
  put(s, 'Forest', 1);
  enter(s, 'Ticket Tortoise');
  put(s, 'Forest');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Treasure Token')
      .length,
    0,
  );
  s = fixture();
  put(s, 'Forest', 1);
  enter(s, 'Ticket Tortoise');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Treasure Token')
      .length,
    1,
  );
});
test('Nightdrinker loses life on normal entry and Sami gains life while producing a Lander', () => {
  let s = fixture();
  enter(s, 'Nightdrinker Moroii');
  s = resolve(s);
  assert.equal(s.players[0].life, 17);
  lands(s, 'Forest', 2);
  const c = put(s, "Sami's Curiosity", 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  assert.equal(s.players[0].life, 19);
  assert(
    Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Lander Token'),
  );
});
test('Mudflat returns a matching subtype card and preserves the broad Oracle selector', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const v = put(s, 'Mudflat Village');
  const target = put(s, 'Voracious Vermin', 0, 'graveyard');
  s = act(s, 'activate', { card: v.id, ability: 0, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'hand');
  assert.equal(s.objects[v.id].zone, 'graveyard');
  assert.equal(
    CARDS['Mudflat Village'].activated[0].target.where.all.some((p) => p.type === 'creature'),
    false,
  );
});
test('Outcaster searches a Desert and updates its own bonus as Deserts enter', () => {
  let s = fixture();
  const desert = put(s, 'Soured Springs', 0, 'library');
  const c = enter(s, 'Outcaster Greenblade');
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert(s.choice.cards.includes(desert.id));
  s = act(s, 'searchLibrary', { cards: [desert.id] });
  assert.equal(s.objects[desert.id].zone, 'hand');
  put(s, 'Soured Springs');
  assert.equal(stats(s, s.objects[c.id]).power, 2);
  assert.equal(stats(s, s.objects[c.id]).toughness, 3);
});
test('Zhao triggers on sacrificing another permanent but not itself or opponents sacrifices', () => {
  let s = fixture();
  const z = put(s, 'Zhao, Ruthless Admiral');
  const b = put(s, 'Grizzly Bears');
  const t = put(s, 'Treasure Token');
  notifyTriggers(s, 'sacrifice', { object: t, controller: 0 });
  stabilize(s);
  s = resolve(s);
  assert.equal(stats(s, s.objects[b.id]).power, 3);
  notifyTriggers(s, 'sacrifice', { object: s.objects[z.id], controller: 0 });
  stabilize(s);
  assert.equal(s.stack.length, 0);
  const enemy = put(s, 'Treasure Token', 1);
  notifyTriggers(s, 'sacrifice', { object: enemy, controller: 1 });
  stabilize(s);
  assert.equal(s.stack.length, 0);
});
