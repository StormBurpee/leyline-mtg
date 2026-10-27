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
const names = ['Spider-Ham, Peter Porker', 'Tundra Tank', 'Restoration Magic', 'Plan the Heist'];
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
test('4 complete v53 tribal and tiered cards compile and round trip every clause', () => {
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
test('Spider-Ham buffs listed friendly types, not itself or opponents', () => {
  let s = fixture();
  const ham = enter(s, 'Spider-Ham, Peter Porker');
  const bear = put(s, 'Grizzly Bears');
  const foe = put(s, 'Grizzly Bears', 1);
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.equal(stats(s, s.objects[foe.id]).power, 2);
  assert.equal(stats(s, s.objects[ham.id]).power, 2);
  assert(Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Food Token'));
});
test('Rakish Crew makes exact Mercenary and drains on an outlaw death', () => {
  let s = fixture();
  enter(s, 'Rakish Crew');
  s = resolve(s);
  const merc = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Mercenary Token',
  );
  assert(merc);
  notifyTriggers(s, 'dies', { object: merc, controller: 0 });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
});
test('Tundra Tank protects an own creature on entry and has combat-only firebending mana', () => {
  let s = fixture();
  const bear = put(s, 'Grizzly Bears');
  const tank = enter(s, 'Tundra Tank');
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  s = resolve(s);
  assert(hasKeyword(s, s.objects[bear.id], 'indestructible'));
  notifyTriggers(s, 'attack', { object: s.objects[tank.id], controller: 0 });
  stabilize(s);
  s = resolve(s);
  assert.equal(
    s.players[0].restrictedMana.filter((m) => m.color === 'R' && m.duration === 'combat').length,
    1,
  );
});
test('Restoration Magic Curaga protects all own permanent types and gains six life', () => {
  let s = fixture();
  lands(s, 'Plains', 6);
  const art = put(s, 'Food Token');
  const spell = put(s, 'Restoration Magic', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 2 });
  s = resolve(s);
  assert.equal(s.players[0].life, 26);
  assert(hasKeyword(s, s.objects[art.id], 'hexproof'));
  assert(
    hasKeyword(
      s,
      Object.values(s.objects).find((o) => o.name === 'Plains' && o.zone === 'battlefield'),
      'indestructible',
    ),
  );
});
test('Sunstar Expansionist has an intervening-if land deficit check', () => {
  let s = fixture();
  lands(s, 'Forest', 1, 1);
  const sun = enter(s, 'Sunstar Expansionist');
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert(
    Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Lander Token'),
  );
  let equal = fixture();
  enter(equal, 'Sunstar Expansionist');
  assert.equal(equal.stack.length, 0);
});
test('Plan the Heist checks hand at resolution and draws even without surveil', () => {
  let s = fixture();
  lands(s, 'Island', 5);
  const card = put(s, 'Plan the Heist', 0, 'hand');
  put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.players[0].hand.length, 4);
  let empty = fixture();
  lands(empty, 'Island', 5);
  const c = put(empty, 'Plan the Heist', 0, 'hand');
  empty = act(empty, 'cast', { card: c.id });
  empty = resolve(empty);
  assert.equal(empty.choice.kind, 'libraryOrder');
});
