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
  'Restless Vents',
  "Ureni's Rebuff",
  "Outlaws' Fury",
  'Vengeful Creeper',
  'Madame Web, Clairvoyant',
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
test('5 complete v51 modal-free utility cards compile and round trip every clause', () => {
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
test('Madame Web permits a top-library noncreature spell but does not permit a non-Spider creature', () => {
  let s = fixture();
  put(s, 'Madame Web, Clairvoyant');
  lands(s, 'Island', 2);
  const spell = put(s, 'Opt', 0, 'library');
  s.players[0].library = [spell.id, ...s.players[0].library.filter((id) => id !== spell.id)];
  assert(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id));
  const bear = put(s, 'Grizzly Bears', 0, 'library');
  s.players[0].library = [bear.id, ...s.players[0].library.filter((id) => id !== bear.id)];
  lands(s, 'Forest', 2);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast' && a.card === bear.id),
    false,
  );
});
test('Outlaws Fury boosts the team then exiles a card with next-turn permission only when an outlaw exists', () => {
  for (const outlaw of [false, true]) {
    let s = fixture();
    lands(s, 'Mountain', 3);
    const target = put(s, outlaw ? 'Mercenary Token' : 'Grizzly Bears');
    const c = put(s, "Outlaws' Fury", 0, 'hand');
    s = act(s, 'cast', { card: c.id });
    s = resolve(s);
    assert.equal(stats(s, s.objects[target.id]).power, outlaw ? 3 : 4);
    assert.equal(s.players[0].exile.length, outlaw ? 1 : 0);
  }
});
test('Vengeful Creeper face-up trigger targets only opposing artifacts or enchantments', () => {
  let s = fixture();
  const c = put(s, 'Vengeful Creeper');
  const target = put(s, 'Ornithopter', 1);
  notifyTriggers(s, 'faceUp', { object: c, controller: 0 });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});
test('Ureni Rebuff returns an opposing creature to its owners hand', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const target = put(s, 'Grizzly Bears', 1);
  const c = put(s, "Ureni's Rebuff", 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'hand');
  assert(s.players[1].hand.includes(target.id));
});
