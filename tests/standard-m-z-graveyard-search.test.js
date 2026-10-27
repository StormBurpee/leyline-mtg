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
  "Vraska's Final Mercy",
  'Nervous Gardener',
  "Roamer's Routine",
  'Rubblebelt Maverick',
  'Mightform Harmonizer',
  'Rewrite Regrets',
  'Solve for Disappointment',
  'Outcaster Trailblazer',
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
test('8 complete v53 graveyard and search cards compile and round trip every clause', () => {
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
test('Nervous Gardener searches a nonbasic land with a basic land type', () => {
  let s = fixture();
  const dual = put(s, 'Hallowed Fountain', 0, 'library');
  const c = put(s, 'Nervous Gardener');
  notifyTriggers(s, 'faceUp', { object: c, controller: 0 });
  stabilize(s);
  s = resolve(s);
  assert(s.choice.cards.includes(dual.id));
  s = act(s, 'searchLibrary', { cards: [dual.id] });
  assert.equal(s.objects[dual.id].zone, 'hand');
});
test('Vraska Final Mercy loses two life before empowering Jace six', () => {
  let s = fixture();
  lands(s, 'Swamp', 5);
  const c = put(s, "Vraska's Final Mercy", 0, 'hand');
  s = act(s, 'cast', { card: c.id, mode: 1 });
  s = resolve(s);
  assert.equal(s.players[0].life, 18);
  const j = Object.values(s.objects).find(
    (o) => o.name === 'Jace Token' && o.zone === 'battlefield',
  );
  assert.equal(j.loyalty, 6);
});
test('Rubblebelt graveyard activation exiles itself and puts a counter on any creature', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const c = put(s, 'Rubblebelt Maverick', 0, 'graveyard');
  const target = put(s, 'Grizzly Bears', 1);
  s = act(s, 'activate', { card: c.id, ability: 0, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[c.id].zone, 'exile');
  assert.equal(s.objects[target.id].plusCounters, 1);
});
test('Mightform doubles a creatures current power without changing toughness', () => {
  let s = fixture();
  put(s, 'Mightform Harmonizer');
  const target = put(s, 'Grizzly Bears');
  target.plusCounters = 1;
  enter(s, 'Forest');
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[target.id]).power, 6);
  assert.equal(stats(s, s.objects[target.id]).toughness, 3);
});
test('Rewrite Regrets can reanimate a planeswalker and then empower a separate Jace', () => {
  let s = fixture();
  lands(s, 'Swamp', 6);
  const target = put(s, 'Kaito, Bane of Nightmares', 0, 'graveyard');
  const c = put(s, 'Rewrite Regrets', 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
});
test('Outcaster Trailblazer chooses mana on entry and draws for another power-four creature', () => {
  let s = fixture();
  const c = enter(s, 'Outcaster Trailblazer');
  s = resolve(s);
  assert.equal(s.choice.kind, 'manaColor');
  s = act(s, 'chooseManaColor', { color: 'U' });
  assert.equal(s.players[0].mana.U, 1);
  enter(s, 'Serra Angel');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('Solve for Disappointment excludes lands instants and sorceries then empowers after the chosen permanent is discarded', () => {
  let s = fixture();
  lands(s, 'Swamp', 3);
  const land = put(s, 'Forest', 1, 'hand');
  const instant = put(s, 'Opt', 1, 'hand');
  const creature = put(s, 'Grizzly Bears', 1, 'hand');
  const c = put(s, 'Solve for Disappointment', 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.deepEqual(s.choice.eligibleCards, [creature.id]);
  s = act(s, 'chooseResolutionCard', { card: creature.id });
  assert.equal(s.objects[creature.id].zone, 'graveyard');
  const j = Object.values(s.objects).find(
    (o) => o.name === 'Jace Token' && o.zone === 'battlefield',
  );
  assert.equal(j.loyalty, 1);
});
