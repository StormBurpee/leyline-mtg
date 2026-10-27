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
  'Ravenous Robots',
  "Thr\u00f3r's Map",
  'Snarling Gorehound',
  'Tidecaller Mentor',
  'Vial Smasher, Gleeful Grenadier',
  'Massacre Wurm',
  'Perimeter Enforcer',
  'Sun-Spider, Nimble Webber',
  'Whiskerquill Scribe',
  'Nezumi Linkbreaker',
  'Sizzling Changeling',
  'Valley Rotcaller',
  'Venom, Evil Unleashed',
  'Prickly Pair',
  'Projektor Inspector',
  'Sandworm',
  'Overrun',
  'Pyrewood Gearhulk',
  'Ooze Spill',
  'Smaug the Magnificent',
  'Wanted Griffin',
  'Professor Zei, Anthropologist',
  'Volcanic Villain',
  'Serpent Specialist',
  'Stone Docent',
  'Witherbloom, the Balancer',
  'War Effort',
  'Mutagen Token',
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
test('27 more Standard sources and the complete Mutagen token compile and round trip every clause', () => {
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
import { move, playableCards } from '../packages/engine/src/model.js';
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
function order(s) {
  return s.choice?.kind === 'orderTriggers'
    ? act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) })
    : s;
}
test('Mutagen costs a mana, tapping and sacrifice then adds a counter to its chosen creature', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const token = put(s, 'Mutagen Token'),
    target = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: token.id, ability: 0, target: ref(target) });
  assert.notEqual(s.objects[token.id]?.zone, 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 1);
});
test('Massacre Wurm kills small opposing creatures and triggers once for each death', () => {
  let s = fixture();
  put(s, 'Grizzly Bears', 1);
  put(s, 'Grizzly Bears', 1);
  enter(s, 'Massacre Wurm');
  s = resolve(s);
  s = order(s);
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.players[1].life, 16);
});
test('Sandworm optional search belongs to the controller of the destroyed land', () => {
  let s = fixture();
  const target = put(s, 'Forest', 1);
  enter(s, 'Sandworm');
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.optional, true);
  const id = s.choice.cards[0];
  s = act(s, 'searchLibrary', { cards: [id] }, 1);
  assert.equal(s.objects[id].controller, 1);
  assert(s.objects[id].tapped);
});
test('Valley Rotcaller counts only other qualifying permanents once across overlapping subtypes', () => {
  let s = fixture();
  const source = put(s, 'Valley Rotcaller');
  put(s, 'Sizzling Changeling');
  put(s, 'Grizzly Bears');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [source.id] });
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
});
test('War Effort triggers once for the group and creates an attacking Warrior with delayed sacrifice', () => {
  let s = fixture();
  put(s, 'War Effort');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  s = resolve(s);
  const warrior = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Mobilized Warrior Token',
  );
  assert(warrior);
  assert.equal(stats(s, warrior).power, 2);
  assert(warrior.tapped);
  assert(s.combat.attackers.some((r) => r.id === warrior.id));
  assert(
    s.delayedTriggers.some(
      (t) => t.rule === 'mobilizeSacrifice' && t.delayedObjects.some((r) => r.id === warrior.id),
    ),
  );
});
test('Sizzling Changeling death exiles the actual library top with next-turn play permission', () => {
  let s = fixture();
  const source = put(s, 'Sizzling Changeling');
  const top = s.players[0].library[0];
  move(s, source, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[top].zone, 'exile');
  assert(playableCards(s, 0).includes(top));
});
test('Witherbloom discounts its own creature spell and separately the controller instant/sorcery spells', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  lands(s, 'Swamp', 1);
  for (let i = 0; i < 6; i++) put(s, 'Grizzly Bears');
  const dragon = put(s, 'Witherbloom, the Balancer', 0, 'hand');
  assert(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === dragon.id));
  const s2 = fixture();
  put(s2, 'Witherbloom, the Balancer');
  put(s2, 'Grizzly Bears');
  lands(s2, 'Island', 2);
  const spell = put(s2, 'Divination', 0, 'hand');
  assert(legalActions(s2, 0).some((a) => a.type === 'cast' && a.card === spell.id));
});
