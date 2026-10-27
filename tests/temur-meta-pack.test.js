import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ref,
  canBlock,
  dispatch,
  legalActions,
  chooseBotCommand,
  definition,
  stats,
  hasKeyword,
  createRegistry,
} from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';

function outburst() {
  const s = fixture();
  lands(s, 'Island', 1);
  lands(s, 'Mountain', 1);
  const card = put(s, 'Vibrant Outburst', 0, 'hand');
  const creature = put(s, 'Grizzly Bears', 1);
  return { s, card, creature };
}
test('Vibrant Outburst damage is mandatory, tapping optional and independently targeted', () => {
  let { s, card, creature } = outburst();
  s = act(s, 'cast', { card: card.id, targets: { damage: [{ kind: 'player', id: 1 }], tap: [] } });
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
  assert.equal(s.objects[creature.id].tapped, false);
});
test('Vibrant Outburst still taps when its damage target becomes illegal', () => {
  let { s, card, creature } = outburst();
  const other = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: card.id, targets: { damage: [ref(creature)], tap: [ref(other)] } });
  move(s, s.objects[creature.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[other.id].tapped, true);
});

for (const mode of [0, 1])
  test(`Secret Identity mode ${mode} changes only creature subtype and base stats`, () => {
    let s = fixture();
    lands(s, 'Island', 1);
    const card = put(s, 'Secret Identity', 0, 'hand');
    const creature = put(s, 'Grizzly Bears', 0);
    creature.plusCounters = 2;
    s.modifiers.push({
      objectId: creature.id,
      incarnation: creature.incarnation,
      power: 2,
      toughness: 1,
      expires: s.turn,
    });
    s = act(s, 'cast', { card: card.id, mode, target: ref(creature) });
    s = resolve(s);
    const o = s.objects[creature.id];
    assert.deepEqual(definition(s, o).subtypes, [mode ? 'Hero' : 'Citizen']);
    assert.deepEqual(definition(s, o).color, ['G']);
    assert.deepEqual(stats(s, o), mode ? { power: 7, toughness: 7 } : { power: 5, toughness: 4 });
    assert.ok(hasKeyword(s, o, mode ? 'flying' : 'hexproof'));
    assert.equal(hasKeyword(s, o, 'vigilance'), !!mode);
    // New incarnation cannot inherit the form or abilities.
    move(s, o, 'exile');
    move(s, o, 'battlefield');
    assert.deepEqual(definition(s, o).subtypes, ['Bear']);
    assert.equal(hasKeyword(s, o, 'hexproof'), false);
  });
test('Secret Identity form expires and preserves land types and noncreature subtypes', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const o = put(s, 'Forest', 0);
  s.modifiers.push({
    objectId: o.id,
    incarnation: o.incarnation,
    addTypes: ['creature'],
    animation: { power: 2, toughness: 2, colors: ['G'], subtypes: ['Bear'] },
    keywords: ['trample'],
    expires: s.turn,
  });
  const spell = put(s, 'Secret Identity', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 1, target: ref(o) });
  s = resolve(s);
  assert.deepEqual(definition(s, s.objects[o.id]).subtypes, ['Forest', 'Hero']);
  assert.deepEqual(definition(s, s.objects[o.id]).types, ['land', 'creature']);
  assert.ok(hasKeyword(s, s.objects[o.id], 'trample'));
  s.turn++;
  assert.deepEqual(definition(s, s.objects[o.id]).subtypes, ['Forest']);
  assert.deepEqual(stats(s, s.objects[o.id]), { power: 0, toughness: 0 });
});
for (const type of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
  test(`Multiversal Passage chooses ${type} before life payment`, () => {
    let s = fixture();
    const card = put(s, 'Multiversal Passage', 0, 'hand');
    s = act(s, 'playLand', { card: card.id });
    assert.equal(s.choice.kind, 'landType');
    s = act(s, 'chooseLandType', { landType: type });
    assert.equal(s.choice.kind, 'entryLife');
    s = act(s, 'payEntryLife', { pay: true });
    const o = s.objects[card.id];
    assert.equal(s.players[0].life, 18);
    assert.equal(o.tapped, false);
    assert.deepEqual(definition(s, o).subtypes, [type]);
    assert.equal(
      definition(s, o).mana,
      { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }[type],
    );
    move(s, o, 'hand');
    assert.equal(o.chosenBasicLandType, undefined);
    assert.deepEqual(definition(s, o).subtypes, []);
  });
test('Multiversal Passage can decline life when unable to pay', () => {
  let s = fixture();
  const o = put(s, 'Multiversal Passage', 0, 'hand');
  s.players[0].life = 1;
  s = act(s, 'playLand', { card: o.id });
  s = act(s, 'chooseLandType', { landType: 'Forest' });
  assert.equal(s.choice.payable, false);
  s = act(s, 'payEntryLife', { pay: false });
  assert.equal(s.objects[o.id].tapped, true);
  assert.equal(s.players[0].life, 1);
});
for (const discard of [false, true])
  test(`Pompous Battlemage prepares an actual spell; optional discard ${discard}`, () => {
    let s = fixture();
    lands(s, 'Mountain', 2);
    const o = put(s, 'Pompous Battlemage // Improvised Act', 0, 'hand');
    s = act(s, 'cast', { card: o.id });
    s = resolve(s);
    const copy = s.objects[o.id].preparedCopy;
    assert.ok(copy);
    const fodder = put(s, 'Forest', 0, 'hand');
    const libraryCount = s.players[0].library.length;
    s = act(s, 'cast', { card: copy.id });
    assert.equal(s.objects[o.id].preparedCopy, undefined);
    s = resolve(s); // prowess
    assert.equal(stats(s, s.objects[o.id]).power, 2);
    s = resolve(s);
    assert.equal(s.choice.kind, 'discardEffect');
    assert.equal(s.choice.optional, true);
    s = act(s, 'discardEffect', { cards: discard ? [fodder.id] : [] });
    assert.equal(s.objects[fodder.id].zone, discard ? 'graveyard' : 'hand');
    assert.equal(s.players[0].library.length, libraryCount - (discard ? 1 : 0));
    assert.equal(s.objects[copy.id], undefined);
    assert.equal(s.stack.length, 0);
  });
test('Wild Ride harmonizes using a summoning-sick creature, paying only remaining generic and red', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  lands(s, 'Forest', 2);
  const o = put(s, 'Wild Ride', 0, 'graveyard');
  const bear = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false });
  s = act(s, 'cast', { card: o.id, target: ref(bear), harmonize: ref(bear) });
  assert.equal(s.objects[bear.id].tapped, true);
  assert.deepEqual(s.stack.at(-1).castingCost, { generic: 2, R: 1 });
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'exile');
  assert.equal(stats(s, s.objects[bear.id]).power, 5);
  assert.ok(hasKeyword(s, s.objects[bear.id], 'haste'));
});
test('Harmonize exiles on any stack departure, does not double-use a mana creature, and permits no tap', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const o = put(s, 'Wild Ride', 0, 'graveyard');
  const elf = put(s, 'Llanowar Elves', 0);
  elf.plusCounters = 2;
  // Power 3 reduces 4 generic to 1; this elf cannot also tap to pay that 1.
  const fail = dispatch(s, {
    type: 'cast',
    player: 0,
    card: o.id,
    target: ref(elf),
    harmonize: ref(elf),
  });
  assert.equal(fail.ok, false);
  lands(s, 'Forest', 1);
  s = act(s, 'cast', { card: o.id, target: ref(elf), harmonize: ref(elf) });
  move(s, s.objects[o.id], 'hand');
  assert.equal(s.objects[o.id].zone, 'exile');
  s = fixture();
  lands(s, 'Mountain', 5);
  const other = put(s, 'Wild Ride', 0, 'graveyard');
  const bear = put(s, 'Grizzly Bears', 0);
  s = act(s, 'cast', { card: other.id, target: ref(bear), harmonize: null });
  assert.equal(s.objects[bear.id].tapped, false);
  s = resolve(s);
  assert.equal(s.objects[other.id].zone, 'exile');
});

test('Harmonize legalActions carries an explicit payment and reads no concealed library', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const o = put(s, 'Wild Ride', 0, 'graveyard');
  const bear = put(s, 'Grizzly Bears', 0);
  bear.plusCounters = 3;
  const savedLibrary = s.players[0].library;
  Object.defineProperty(s.players[0], 'library', {
    get() {
      throw Error('hidden library');
    },
    configurable: true,
  });
  const action = legalActions(s, 0).find(
    (a) => a.type === 'cast' && a.card === o.id && a.harmonize?.id === bear.id,
  );
  assert.ok(action);
  assert.equal(action.target.kind, 'object');
  Object.defineProperty(s.players[0], 'library', {
    value: savedLibrary,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const result = dispatch(s, { ...action, player: 0 });
  assert.equal(result.ok, true, result.error?.message);
});
const otterName = "Elusive Otter // Grove's Bounty";
test("Grove's Bounty announces X, divides counters, loses only illegal shares, then permits creature casting", () => {
  let s = fixture();
  lands(s, 'Forest', 6);
  lands(s, 'Island', 1);
  const o = put(s, otterName, 0, 'hand'),
    a = put(s, 'Grizzly Bears', 0),
    b = put(s, 'Grizzly Bears', 0);
  const args = {
    card: o.id,
    mode: 1,
    x: 5,
    targets: { distributed: [ref(a), ref(b)] },
    distribution: { [a.id]: 2, [b.id]: 3 },
  };
  s = act(s, 'cast', args);
  assert.equal(definition(s, s.objects[o.id]).name, "Grove's Bounty");
  move(s, s.objects[a.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[b.id].plusCounters, 3);
  assert.equal(s.objects[o.id].zone, 'exile');
  s = act(s, 'cast', { card: o.id, mode: 0 });
  s = resolve(s);
  assert.equal(definition(s, s.objects[o.id]).name, 'Elusive Otter');
});
test("Grove's Bounty accepts X zero with no targets, rejects zero shares and incorrect sums", () => {
  let s = fixture();
  lands(s, 'Forest', 6);
  const o = put(s, otterName, 0, 'hand'),
    a = put(s, 'Grizzly Bears', 0);
  for (const division of [{ [a.id]: 0 }, { [a.id]: 3 }, {}])
    assert.equal(
      dispatch(s, {
        type: 'cast',
        player: 0,
        card: o.id,
        mode: 1,
        x: 2,
        targets: { distributed: [ref(a)] },
        distribution: division,
      }).ok,
      false,
    );
  s = act(s, 'cast', { card: o.id, mode: 1, x: 0, targets: { distributed: [] }, distribution: {} });
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'exile');
});
test('Elusive Otter lower-power blocking restriction reads effective current power', () => {
  const s = fixture(),
    o = put(s, otterName, 0),
    bear = put(s, 'Grizzly Bears', 1);
  assert.equal(canBlock(s, bear, o, 1), true);
  o.plusCounters = 2;
  assert.equal(canBlock(s, bear, o, 1), false);
  bear.plusCounters = 1;
  assert.equal(canBlock(s, bear, o, 1), true);
});
test('Otter bot announces a legal distributed Adventure with a positive counter allocation', () => {
  const s = fixture();
  lands(s, 'Forest', 5);
  const o = put(s, otterName, 0, 'hand');
  put(s, 'Grizzly Bears', 0);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'cast');
  assert.equal(command.card, o.id);
  assert.equal(command.mode, 1);
  assert.ok(command.x > 0);
  assert.equal(dispatch(s, command).ok, true);
});
