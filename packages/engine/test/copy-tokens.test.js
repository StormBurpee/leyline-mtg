import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  createGame,
  definition,
  stats,
  keywords,
  ref,
  playerView,
  dispatch,
  exportReplay,
  replay,
  validateDefinition,
} from '../src/index.js';
import { move, queueTrigger } from '../src/model.js';
import { resolveEffects, continueResolution } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { inspect } from '../../../apps/web/view.js';
const tokens = (s) => Object.values(s.objects).filter((o) => o.token && o.zone === 'battlefield');
function copy(s, source, count = 1, exceptions) {
  resolveEffects(s, {
    controller: 0,
    target: ref(source),
    effects: [{ op: 'copyToken', count, ...(exceptions ? { exceptions } : {}) }],
  });
  return tokens(s).at(-1);
}
test('copies printed values, not counters, damage, attachment, choices or temporary effects; controller owns token', () => {
  const s = fixture(),
    source = put(s, 'Grizzly Bears', 1);
  source.plusCounters = 4;
  source.damage = 1;
  source.tapped = true;
  source.chosenCreatureType = 'Elf';
  source.chosenX = 8;
  source.attachedTo = ref(put(s, 'Forest'));
  s.modifiers.push({
    objectId: source.id,
    incarnation: source.incarnation,
    power: 3,
    toughness: 3,
    keywords: ['haste'],
    expires: s.turn,
  });
  const token = copy(s, source);
  assert.equal(token.owner, 0);
  assert.equal(token.controller, 0);
  assert.equal(token.token, true);
  assert.deepEqual(stats(s, token), { power: 2, toughness: 2 });
  assert.equal(token.damage, 0);
  assert.equal(token.plusCounters, 0);
  assert.equal(token.tapped, false);
  assert.equal(token.attachedTo, null);
  assert.equal(token.chosenCreatureType, undefined);
  assert.equal(token.chosenX, undefined);
  assert.ok(!keywords(s, token).includes('haste'));
});
test('copies an existing definitionOverride, and each copy is an independent snapshot', () => {
  const s = fixture(),
    source = put(s, 'Grizzly Bears');
  source.definitionOverride = { ...structuredClone(CARDS['Ornithopter']), name: 'Changed Bear' };
  const first = copy(s, source);
  source.definitionOverride.power = 9;
  const second = copy(s, first);
  assert.equal(first.name, 'Changed Bear');
  assert.equal(second.name, 'Changed Bear');
  assert.equal(definition(s, second).power, 0);
  assert.ok(definition(s, second).types.includes('artifact'));
});
test('copying a disguised permanent produces a face-up nameless 2/2, never its printed identity', () => {
  const s = fixture(),
    source = put(s, 'Grizzly Bears', 1);
  source.faceDown = true;
  const token = copy(s, source),
    d = definition(s, token);
  assert.equal(token.name, '');
  assert.equal(token.faceDown, undefined);
  assert.equal(d.name, '');
  assert.deepEqual(d.ward, { mana: { generic: 2 } });
  assert.deepEqual(d.cost, {});
  assert.deepEqual(d.subtypes, []);
  assert.deepEqual(stats(s, token), { power: 2, toughness: 2 });
  assert.ok(!JSON.stringify(playerView(s, 0).objects[token.id]).includes('Grizzly Bears'));
  assert.equal(dispatch(s, { type: 'turnFaceUp', player: 0, card: token.id }).ok, false);
  const ui = inspect('', {}, s, token.id, 0);
  assert.match(ui, /Nameless token/);
  assert.doesNotMatch(ui, /Grizzly Bears/);
});
test('temporary crew animation is not copiable, including offspring current-source and departure LKI', () => {
  for (const departed of [false, true]) {
    const s = fixture(),
      source = put(s, 'Strixhaven Skycoach');
    s.modifiers.push({
      objectId: source.id,
      incarnation: source.incarnation,
      power: 0,
      toughness: 0,
      keywords: [],
      addTypes: ['creature'],
      expires: s.turn,
    });
    assert.equal(definition(s, source).type, 'creature');
    const token = copy(s, source);
    assert.equal(definition(s, token).type, 'artifact');
    queueTrigger(s, source, [{ op: 'offspringCopy' }], 'offspring');
    if (departed) move(s, source, 'graveyard');
    resolveEffects(
      s,
      s.pendingTriggers.find((e) => e.label === 'offspring'),
    );
    const baby = tokens(s).at(-1);
    assert.equal(definition(s, baby).type, 'artifact');
    assert.equal(definition(s, baby).power, 1);
  }
});
test('copied CDA remains live for the new controller; fixed P/T exception removes the CDA', () => {
  const s = fixture(),
    source = put(s, 'Crusader of Odric', 1);
  put(s, 'Grizzly Bears');
  const token = copy(s, source);
  assert.ok(definition(s, token).baseStats);
  assert.equal(stats(s, token).power, 2);
  put(s, 'Grizzly Bears');
  assert.equal(stats(s, token).power, 3);
  const fixed = copy(s, source, 1, {
    power: 4,
    toughness: 4,
    nonlegendary: true,
    addSubtypes: ['Hero'],
  });
  assert.equal(definition(s, fixed).baseStats, undefined);
  assert.equal(stats(s, fixed).power, 4);
  assert.ok(definition(s, fixed).subtypes.includes('Hero'));
  const again = copy(s, fixed);
  assert.equal(stats(s, again).power, 4);
  assert.equal(definition(s, again).baseStats, undefined);
});
test('Rite kicked copies enter simultaneously and see every other entering Soul Warden', () => {
  let s = fixture();
  lands(s, 'Island', 9);
  const source = put(s, 'Soul Warden');
  const spell = put(s, 'Rite of Replication', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, mode: 1, target: ref(source) }));
  assert.equal(tokens(s).length, 5);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 25);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});
test('legendary copies preserve name and supertype and enter together before legend choices', () => {
  let s = fixture();
  lands(s, 'Island', 9);
  const source = put(s, 'Yargle and Multani');
  const spell = put(s, 'Rite of Replication', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, mode: 1, target: ref(source) }));
  assert.equal(tokens(s).length, 5);
  assert.equal(s.choice.kind, 'legendRule');
  assert.equal(s.choice.cards.length, 6);
  const keep = tokens(s)[0];
  s = act(s, 'chooseLegend', { card: keep.id });
  assert.equal(tokens(s).length, 1);
  assert.equal(s.objects[source.id].zone, 'graveyard');
});
test('Ember Island modes preserve all other characteristics and make nonlegendary Hero/Coward copies', () => {
  for (const [mode, controller, power, subtype] of [
    [0, 0, 4, 'Hero'],
    [1, 1, 2, 'Coward'],
  ]) {
    let s = fixture();
    lands(s, 'Island', 5);
    const source = put(s, 'Yargle and Multani', controller);
    const spell = put(s, 'Ember Island Production', 0, 'hand');
    s = resolve(act(s, 'cast', { card: spell.id, mode, target: ref(source) }));
    const token = tokens(s)[0];
    assert.equal(s.choice, null);
    assert.equal(definition(s, token).legendary, undefined);
    assert.equal(stats(s, token).power, power);
    assert.ok(definition(s, token).subtypes.includes(subtype));
    assert.equal(token.owner, 0);
    assert.match(inspect(token.name, {}, s, token.id, 0), new RegExp(`${power}/${power}`));
  }
});
test('Relm copies lands and artifacts, and copied Cavern makes a fresh choice before continuing resolution', () => {
  let s = fixture();
  lands(s, 'Island', 4);
  const source = put(s, 'Cavern of Souls', 1);
  source.chosenCreatureType = 'Elf';
  const spell = put(s, "Relm's Sketching", 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(source) }));
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.objects[spell.id].zone, 'stack');
  assert.equal(tokens(s).length, 0);
  assert.equal(s.objects[s.choice.card].chosenCreatureType, undefined);
  s = act(s, 'chooseCreatureType', { creatureType: 'Goblin' });
  assert.equal(tokens(s)[0].chosenCreatureType, 'Goblin');
  assert.equal(tokens(s)[0].owner, 0);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});
test('multiple copied Caverns choose independently and all enter only after the final choice', () => {
  let s = fixture();
  const source = put(s, 'Cavern of Souls');
  source.chosenCreatureType = 'Elf';
  const entry = {
    kind: 'ability',
    name: 'Copy',
    source: ref(source),
    controller: 0,
    target: ref(source),
    effects: [
      { op: 'copyToken', count: 2 },
      { op: 'gainLife', amount: 3 },
    ],
  };
  s.resolving = { entry, index: 0 };
  continueResolution(s);
  assert.equal(s.players[0].life, 20);
  s = act(s, 'chooseCreatureType', { creatureType: 'Goblin' });
  assert.equal(tokens(s).length, 0);
  assert.equal(s.players[0].life, 20);
  s = act(s, 'chooseCreatureType', { creatureType: 'Human' });
  assert.equal(tokens(s).length, 2);
  assert.equal(s.players[0].life, 23);
  assert.deepEqual(
    tokens(s).map((o) => o.chosenCreatureType),
    ['Goblin', 'Human'],
  );
});
test('copied Auras choose new legal attachments without copying the original attachment', () => {
  let s = fixture();
  const one = put(s, 'Grizzly Bears'),
    two = put(s, 'Grizzly Bears');
  const aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(one);
  const entry = {
    kind: 'ability',
    name: 'Copy',
    source: ref(aura),
    controller: 0,
    target: ref(aura),
    effects: [
      { op: 'copyToken', count: 2 },
      { op: 'gainLife', amount: 3 },
    ],
  };
  s.resolving = { entry, index: 0 };
  continueResolution(s);
  assert.equal(s.choice.kind, 'auraEntry');
  s = act(s, 'chooseAuraAttachment', { card: two.id });
  assert.equal(tokens(s).length, 0);
  s = act(s, 'chooseAuraAttachment', { card: one.id });
  assert.equal(tokens(s).length, 2);
  assert.equal(s.players[0].life, 23);
  assert.deepEqual(
    tokens(s).map((o) => o.attachedTo.id),
    [two.id, one.id],
  );
});
test('Self-Reflection flashback exiles after copying and invalidated targets fizzle without LKI copying', () => {
  for (const invalid of [false, true]) {
    let s = fixture();
    lands(s, 'Island', 4);
    const source = put(s, 'Grizzly Bears');
    const spell = put(s, 'Self-Reflection', 0, 'graveyard');
    s = act(s, 'cast', { card: spell.id, target: ref(source) });
    if (invalid) {
      move(s, s.objects[source.id], 'graveyard');
      move(s, s.objects[source.id], 'battlefield');
    }
    s = resolve(s);
    assert.equal(tokens(s).length, invalid ? 0 : 1);
    assert.equal(s.objects[spell.id].zone, 'exile');
  }
});
test('copy authoring fails closed on source/LKI, delayed, arbitrary exceptions, and nonpermanent targets', () => {
  const base = { name: 'Invalid copy', type: 'sorcery', cost: {}, target: 'creature' };
  for (const effect of [
    { op: 'copyToken', count: -1 },
    { op: 'copyToken', count: 1001 },
    { op: 'copyToken', count: { kind: 'x' } },
    { op: 'copyToken', count: 1, subject: 'source' },
    { op: 'copyToken', count: 1, exceptions: { haste: true } },
    { op: 'copyToken', count: 1, exceptions: { power: 1 } },
    { op: 'copyToken', count: 1, delayedSacrifice: true },
  ])
    assert.ok(validateDefinition({ ...base, effects: [effect] }).length);
  for (const target of ['spell', { scope: 'graveyard' }, 'player'])
    assert.ok(
      validateDefinition({ ...base, target, effects: [{ op: 'copyToken', count: 1 }] }).length,
    );
});
test('copy resolution and a paused copied-Cavern choice replay deterministically', () => {
  const free = {
    name: 'Replay copy',
    type: 'instant',
    cost: {},
    target: 'permanent',
    effects: [{ op: 'copyToken', count: 2 }],
  };
  const cavern = { ...CARDS['Cavern of Souls'] };
  const deck = [
    free.name,
    free.name,
    free.name,
    cavern.name,
    cavern.name,
    cavern.name,
    cavern.name,
  ];
  let s = createGame({
    catalog: createRegistry([free, cavern]),
    decks: [deck, deck],
    minimumDeckSize: 7,
    mulligan: false,
  });
  s = resolve(s);
  s = resolve(s); // upkeep, draw -> main1
  const land = s.players[0].hand.find((id) => s.objects[id].name === cavern.name);
  s = act(s, 'playLand', { card: land });
  s = act(s, 'chooseCreatureType', { creatureType: 'Elf' });
  const spell = s.players[0].hand.find((id) => s.objects[id].name === free.name);
  s = resolve(act(s, 'cast', { card: spell, target: ref(s.objects[land]) }));
  assert.equal(s.choice.kind, 'creatureType');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseCreatureType', { creatureType: 'Goblin' });
  s = act(s, 'chooseCreatureType', { creatureType: 'Human' });
  assert.equal(tokens(s).length, 2);
  assert.deepEqual(replay(exportReplay(s)), s);
});
