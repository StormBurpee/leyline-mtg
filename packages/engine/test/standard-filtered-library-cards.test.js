import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { CARDS, ref, keywords, stats, playerView } from '../src/index.js';
import { move, tapObjects, untapObject } from '../src/model.js';
import { stabilize, enterBattlefield } from '../src/effects.js';
import { declareAttackers } from '../src/combat.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const cards = [
  ['Eclipsed Boggart', 'eclipsed-boggart', 4, 'Mountain'],
  ['Eclipsed Elf', 'eclipsed-elf', 4, 'Forest'],
  ['Eclipsed Flamekin', 'eclipsed-flamekin', 4, 'Island'],
  ['Eclipsed Kithkin', 'eclipsed-kithkin', 4, 'Plains'],
  ['Eclipsed Merrow', 'eclipsed-merrow', 4, 'Island'],
  ['Commune with Nature', 'commune-with-nature', 5, 'Grizzly Bears', 'spell'],
  ['Commune with Beavers', 'commune-with-beavers', 3, 'Murmuring Volume', 'spell'],
  ['Cowabunga!', 'cowabunga', 4, 'Changeling Wayfinder', 'spell'],
  ['Frontier Seeker', 'frontier-seeker', 5, 'Plains'],
  ['Beastrider Vanguard', 'beastrider-vanguard', 3, 'Murmuring Volume', 'activate'],
  ['Ashe, Princess of Dalmasca', 'ashe-princess-of-dalmasca', 5, 'Murmuring Volume', 'attack'],
  ['Casey Jones, Jury-Rig Justiciar', 'casey-jones-jury-rig-justiciar', 4, 'Murmuring Volume'],
  ["Dáin's Company", 'dain-s-company', 4, 'Basilisk Collar'],
  ['Boughside Wanderers', 'boughside-wanderers', 4, 'Forest'],
  ['Dragonologist', 'dragonologist', 6, 'Opt'],
  ['Guru Pathik', 'guru-pathik', 5, 'Accumulate Wisdom'],
  ['Living Phone', 'living-phone', 5, 'Grizzly Bears', 'dies'],
  ['Lupinflower Village', 'lupinflower-village', 6, 'Changeling Wayfinder', 'activate'],
];
function rich() {
  const s = fixture();
  for (const name of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) lands(s, name, 8);
  return s;
}
function top(s, names, player = 0) {
  const ids = names.map((name) => put(s, name, player, 'library').id);
  s.players[player].library = [
    ...ids,
    ...s.players[player].library.filter((id) => !ids.includes(id)),
  ];
  return ids;
}
function finish(s, ids = []) {
  return act(s, 'orderLibrary', {
    top: ids,
    rest: s.choice.cards.filter((id) => !ids.includes(id)),
  });
}
for (const [name, , count, matching, mode] of cards) {
  test(`${name} executes its full real selection ability and reveals the selected identity`, () => {
    let s = rich();
    const inspected = top(s, [matching, ...Array(count - 1).fill('Grizzly Bears')]);
    const source = put(s, name, 0, mode && mode !== 'spell' ? 'battlefield' : 'hand');
    if (mode === 'activate') s = act(s, 'activate', { card: source.id, ability: 0 });
    else if (mode === 'attack') {
      s.step = 'attackers';
      declareAttackers(s, [source.id]);
      stabilize(s);
    } else if (mode === 'dies') {
      move(s, source, 'graveyard');
      stabilize(s);
    } else {
      s = act(s, 'cast', { card: source.id });
      s = resolve(s);
    }
    if (!s.choice) s = resolve(s);
    assert.equal(s.choice.kind, 'libraryOrder');
    assert.equal(s.choice.player, 0);
    assert.equal(s.choice.cards.length, count);
    assert.equal(s.choice.optional, true);
    assert.equal(s.choice.reveal, true);
    assert.ok(s.choice.eligibleCards.includes(inspected[0]));
    assert.equal(s.choice.selectCount, 1);
    const restOrder = s.choice.restOrder;
    assert.equal(
      restOrder,
      ['Commune with Nature', 'Commune with Beavers', 'Beastrider Vanguard'].includes(name)
        ? 'chosen'
        : 'random',
    );
    if (mode === 'dies' || name === 'Lupinflower Village')
      assert.equal(s.objects[source.id].zone, 'graveyard');
    const events = s.events.length;
    s = finish(s, [inspected[0]]);
    assert.equal(s.objects[inspected[0]].zone, 'hand');
    assert.deepEqual(s.events.findLast((e) => e.type === 'lookChooseHand').revealed, [matching]);
    assert.ok(!s.events.slice(events).some((e) => e.type === 'draw'));
    assert.equal(playerView(s, 1).objects[inspected[0]], undefined);
  });
}
test('all eighteen complete sources validate and match compiled declarations without stripping clauses', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const mechanics = JSON.parse(
    await readFile(new URL('../../cards/mechanics.json', import.meta.url)),
  );
  for (const [name, slug] of cards) {
    const source = JSON.parse(
      await readFile(new URL(`../../cards/cards/${slug}.json`, import.meta.url)),
    );
    assert.ok(validate(source), JSON.stringify(validate.errors));
    const result = compileCard(source);
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.equal(CARDS[name].text, source.rulesText);
    assert.deepEqual(result.definition, CARDS[name]);
    const roundtrip = compileCard(sourceFromDefinition(CARDS[name], { id: source.id }), {
      mechanics,
    });
    assert.ok(roundtrip.ok, JSON.stringify(roundtrip.diagnostics));
    assert.deepEqual(roundtrip.definition, result.definition);
  }
});
test('the five Eclipsed filters accept changelings and reject unrelated creature and basic land types', () => {
  for (const [name, , , land] of cards.slice(0, 5)) {
    let s = rich();
    const invalidLand = ['Forest', 'Plains', 'Swamp', 'Mountain', 'Island'].find(
      (n) => !CARDS[name].text.includes(n),
    );
    const ids = top(s, ['Changeling Wayfinder', land, invalidLand, 'Grizzly Bears']);
    const source = put(s, name, 0, 'hand');
    s = resolve(act(s, 'cast', { card: source.id }));
    move(s, s.objects[source.id], 'graveyard');
    s = resolve(s);
    assert.deepEqual(s.choice.eligibleCards, ids.slice(0, 2));
    assert.throws(() => finish(s, [ids[2]]), /eligible/);
    s = finish(s, []);
    assert.equal(s.players[0].hand.length, 0);
  }
});
test("Dáin's Company needs another controlled Dwarf and supports changeling", () => {
  const s = rich(),
    source = put(s, "Dáin's Company");
  assert.ok(!keywords(s, source).includes('lifelink'));
  put(s, "Dáin's Company", 1);
  assert.ok(!keywords(s, source).includes('lifelink'));
  const other = put(s, 'Changeling Wayfinder');
  assert.ok(keywords(s, source).includes('lifelink'));
  move(s, other, 'graveyard');
  assert.ok(!keywords(s, source).includes('lifelink'));
});
test('Dragonologist grants hexproof only to untapped controlled Dragons and loses its grant on departure', () => {
  const s = rich(),
    source = put(s, 'Dragonologist'),
    dragon = put(s, 'Changeling Wayfinder'),
    other = put(s, 'Changeling Wayfinder', 1),
    bear = put(s, 'Grizzly Bears');
  assert.ok(keywords(s, dragon).includes('hexproof'));
  assert.ok(!keywords(s, other).includes('hexproof'));
  assert.ok(!keywords(s, bear).includes('hexproof'));
  tapObjects(s, [dragon]);
  assert.ok(!keywords(s, dragon).includes('hexproof'));
  untapObject(s, dragon);
  assert.ok(keywords(s, dragon).includes('hexproof'));
  move(s, source, 'graveyard');
  assert.ok(!keywords(s, dragon).includes('hexproof'));
});
test('Boughside Wanderers retains its independent own-landfall +2/+2 ability', () => {
  let s = rich();
  const source = put(s, 'Boughside Wanderers');
  enterBattlefield(s, put(s, 'Forest', 1, 'hand'), 1);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  enterBattlefield(s, put(s, 'Forest', 0, 'hand'), 0);
  stabilize(s);
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[source.id]), { power: 6, toughness: 6 });
});
test('Guru Pathik triggers for each Lesson/Saga/Shrine spell and cannot counter itself or an enemy', () => {
  for (const subtype of ['Lesson', 'Saga', 'Shrine']) {
    let s = rich();
    const guru = put(s, 'Guru Pathik'),
      bear = put(s, 'Grizzly Bears'),
      enemy = put(s, 'Grizzly Bears', 1);
    const spell = put(s, 'Opt', 0, 'hand');
    spell.definitionOverride = { ...CARDS.Opt, subtypes: [subtype] };
    s = act(s, 'cast', { card: spell.id });
    assert.equal(s.choice.kind, 'triggerTarget');
    assert.throws(() => act(s, 'chooseTriggerTarget', { target: ref(s.objects[guru.id]) }));
    assert.throws(() => act(s, 'chooseTriggerTarget', { target: ref(s.objects[enemy.id]) }));
    s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[bear.id]) });
    move(s, s.objects[guru.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[bear.id].plusCounters, 1);
  }
});
test('Living Phone uses its death controller and rejects higher-power creatures; graveyard replacement prevents the trigger', () => {
  let s = rich();
  const ids = top(s, ['Grizzly Bears', 'Colossal Dreadmaw', 'Island', 'Opt', 'Llanowar Elves'], 1);
  const phone = put(s, 'Living Phone');
  phone.controller = 1;
  move(s, phone, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.deepEqual(s.choice.eligibleCards, [ids[0], ids[4]]);
  assert.equal(s.choice.player, 1);
  s = finish(s, [ids[0]]);
  assert.equal(s.players[1].hand.length, 1);
  s = rich();
  put(s, 'Rest in Peace');
  const replacement = put(s, 'Living Phone');
  move(s, replacement, 'graveyard');
  stabilize(s);
  assert.equal(replacement.zone, 'exile');
  assert.equal(s.stack.length, 0);
});
test('Lupinflower restricted white mana cannot pay for a noncreature spell or its own activated cost', () => {
  let s = fixture();
  put(s, 'Lupinflower Village');
  const instant = put(s, 'Moment of Triumph', 0, 'hand'),
    target = put(s, 'Grizzly Bears');
  assert.throws(() => act(s, 'cast', { card: instant.id, target: ref(target) }));
  const creature = put(s, 'Savannah Lions', 0, 'hand');
  s = act(s, 'cast', { card: creature.id });
  assert.equal(s.stack.length, 1);
  s = fixture();
  const village = put(s, 'Lupinflower Village');
  put(s, 'Lupinflower Village');
  lands(s, 'Forest', 1);
  assert.throws(() => act(s, 'activate', { card: village.id, ability: 0 }));
});
