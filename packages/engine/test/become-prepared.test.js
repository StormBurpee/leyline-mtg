import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { compilePack } from '../../cards/pack.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import {
  CARDS,
  createRegistry,
  createGame,
  exportReplay,
  replay,
  dispatch,
  legalActions,
  ref,
  stats,
} from '../src/index.js';
import {
  definition,
  move,
  notifyTriggers,
  preparePermanent,
  unpreparePermanent,
  playableCards,
} from '../src/model.js';
import { enterBattlefieldBatch, resolveEffects, stabilize } from '../src/effects.js';
import { meetsCondition } from '../src/conditions.js';
import { validateCondition } from '../src/condition-schema.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const files = [
  'abigale-poet-laureate-heroic-stanza',
  'emeritus-of-abundance-regrowth',
  'emeritus-of-conflict-lightning-bolt',
  'encouraging-aviator-jump',
  'joined-researchers-secret-rendezvous',
  'scathing-shadelock-venomous-words',
  'stingerquill-voxmancer-vicious-verse',
  'tam-observant-sequencer-deep-sight',
  'woodwork-prodigy-soul-tether',
  'infirmary-healer-stream-of-life',
  'skycoach-waypoint',
];
const sources = [...files, 'heartwood'].map((file) =>
  JSON.parse(readFileSync(new URL(`../../cards/cards/${file}.json`, import.meta.url))),
);
const compiled = compilePack(sources);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
const definitions = Object.fromEntries(compiled.definitions.map((d) => [d.name, d]));
const names = Object.fromEntries(
  compiled.definitions.map((d) => [d.name.split(' // ')[0], d.name]),
);
function setup() {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, ...definitions });
  return s;
}
function enter(s, name, player = 0) {
  const o = put(s, names[name] ?? name, player, 'hand');
  enterBattlefieldBatch(s, [{ object: o, controller: player }]);
  return o;
}
function notify(s, event, payload) {
  notifyTriggers(s, event, payload);
  stabilize(s);
  return s;
}
const sourceEffect = (s, source, op, extra = {}) =>
  resolveEffects(s, {
    source: ref(source),
    controller: source.controller,
    effects: [{ op, subject: 'source' }],
    ...extra,
  });

test('eleven preparation sources pass schema, compilation, color and authoring roundtrip gates', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const valid = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  for (const source of sources) {
    assert.equal(valid(source), true, `${source.name}: ${JSON.stringify(valid.errors)}`);
    const d = definitions[source.name];
    const back = source.abilities.find((a) => a.kind === 'prepare')?.spell;
    for (const face of [source, back].filter(Boolean)) {
      const cost = face.characteristics.manaCost ?? '';
      if (!face.characteristics.token)
        assert.deepEqual(
          face.characteristics.colors,
          [...'WUBRG'].filter((c) => cost.includes(c)),
        );
    }
    const idsByName = Object.fromEntries(sources.map((s) => [s.name, s.id]));
    const identities = Object.fromEntries(sources.map((s) => [s.id, s.name]));
    const roundtrip = compileCard(sourceFromDefinition(d, { id: source.id, idsByName }), {
      identities,
    });
    assert.equal(roundtrip.ok, true, JSON.stringify(roundtrip.diagnostics));
    assert.deepEqual(canonical(roundtrip.definition), canonical(d));
  }
});

test('prepare and unprepare are idempotent and only current preparation creatures can prepare', () => {
  const s = setup(),
    o = put(s, names['Stingerquill Voxmancer']);
  sourceEffect(s, o, 'prepare');
  const first = o.preparedCopy.id;
  sourceEffect(s, o, 'prepare');
  assert.equal(o.preparedCopy.id, first);
  assert.equal(s.players[0].exile.length, 1);
  sourceEffect(s, o, 'unprepare');
  assert.equal(o.preparedCopy, undefined);
  assert.equal(playableCards(s, 0).includes(first), false);
  sourceEffect(s, o, 'unprepare');
  sourceEffect(s, o, 'prepare');
  assert.notEqual(o.preparedCopy.id, first);
  stabilize(s);
  assert.equal(s.objects[first], undefined);
  const ordinary = put(s, 'Grizzly Bears');
  sourceEffect(s, ordinary, 'prepare');
  assert.equal(ordinary.preparedCopy, undefined);
  const transformed = put(s, names['Stingerquill Voxmancer']);
  transformed.definitionOverride = { ...definition(s, transformed), type: 'land', types: ['land'] };
  sourceEffect(s, transformed, 'prepare');
  assert.equal(transformed.preparedCopy, undefined);
});

test('preparation is independent of lost abilities and control, and old source refs cannot prepare a blink', () => {
  const s = setup(),
    o = put(s, names['Stingerquill Voxmancer']);
  resolveEffects(s, {
    controller: 0,
    source: ref(o),
    target: ref(o),
    effects: [{ op: 'removeAbilities', until: 'endOfTurn' }],
  });
  assert.equal(definition(s, o).triggers, undefined);
  assert.ok(definition(s, o).prepareSpell);
  sourceEffect(s, o, 'prepare');
  const id = o.preparedCopy.id;
  assert.equal(meetsCondition(s, 0, { kind: 'sourcePrepared', prepared: true }, [], ref(o)), true);
  o.controller = 1;
  assert.equal(playableCards(s, 0).includes(id), false);
  assert.equal(playableCards(s, 1).includes(id), true);
  const old = ref(o);
  move(s, o, 'exile');
  enterBattlefieldBatch(s, [{ object: o }]);
  resolveEffects(s, {
    controller: 0,
    source: old,
    effects: [{ op: 'prepare', subject: 'source' }],
  });
  assert.equal(o.preparedCopy, undefined);
  assert.equal(meetsCondition(s, 0, { kind: 'sourcePrepared', prepared: false }, [], old), false);
  stabilize(s);
  assert.equal(s.objects[id], undefined);
});

test('target and attachment bindings unprepare the exact incarnation only', () => {
  const s = setup(),
    o = enter(s, 'Infirmary Healer'),
    aura = put(s, 'Charmed Sleep');
  aura.attachedTo = ref(o);
  sourceEffect(s, aura, 'unprepare', { effects: [{ op: 'unprepare', subject: 'attached' }] });
  assert.equal(o.preparedCopy, undefined);
  resolveEffects(s, { controller: 0, target: ref(o), effects: [{ op: 'prepare' }] });
  assert.ok(o.preparedCopy);
  const old = ref(o);
  move(s, o, 'exile');
  enterBattlefieldBatch(s, [{ object: o }]);
  const id = o.preparedCopy.id;
  resolveEffects(s, { controller: 0, target: old, effects: [{ op: 'unprepare' }] });
  assert.equal(o.preparedCopy.id, id);
});

test('prepare effect validation rejects unknown fields, player targets and invalid status predicates', () => {
  const spell = {
    name: 'Invalid Preparation',
    type: 'instant',
    cost: {},
    target: 'player',
    effects: [{ op: 'prepare' }],
  };
  assert.throws(() => createRegistry([spell]), /compatible target/);
  assert.throws(
    () =>
      createRegistry([
        { ...spell, target: 'creature', effects: [{ op: 'prepare', subject: 'opponent' }] },
      ]),
    /subject/,
  );
  assert.throws(
    () =>
      createRegistry([
        { ...spell, target: 'creature', effects: [{ op: 'unprepare', extra: true }] },
      ]),
    /unsupported effect parameter/,
  );
  assert.ok(validateCondition({ kind: 'sourcePrepared', prepared: 0 }).length);
  assert.ok(validateCondition({ kind: 'sourcePrepared', prepared: false, count: 1 }).length);
});

test('upkeep preparation is an intervening-if trigger, not an entry ability', () => {
  let s = setup();
  const o = enter(s, 'Stingerquill Voxmancer');
  assert.equal(o.preparedCopy, undefined);
  assert.equal(s.pendingTriggers.length, 0);
  notify(s, 'step', { step: 'upkeep', player: 1 });
  assert.equal(s.stack.length, 0);
  notify(s, 'step', { step: 'upkeep', player: 0 });
  assert.equal(s.stack.length, 1);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
  preparePermanent(s, s.objects[o.id]);
  const id = s.objects[o.id].preparedCopy.id;
  s = resolve(s);
  assert.equal(s.objects[o.id].preparedCopy.id, id);
  notify(s, 'step', { step: 'upkeep', player: 0 });
  assert.equal(s.stack.length, 0);
  lands(s, 'Swamp', 1);
  s = resolve(act(s, 'cast', { card: id, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].life, 19);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
  notify(s, 'step', { step: 'upkeep', player: 0 });
  s = resolve(s);
  assert.ok(s.objects[o.id].preparedCopy);
  assert.notEqual(s.objects[o.id].preparedCopy.id, id);
});

test('Skycoach Waypoint pays three and taps, has normal target legality, and source may leave', () => {
  let s = setup();
  const land = put(s, names['Skycoach Waypoint']),
    o = put(s, names['Encouraging Aviator']);
  const input = JSON.stringify(s);
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: land.id, ability: 0, target: ref(o) }).ok,
    false,
  );
  assert.equal(JSON.stringify(s), input);
  lands(s, 'Forest', 3);
  s = act(s, 'activate', { card: land.id, ability: 0, target: ref(o) });
  assert.equal(s.objects[land.id].tapped, true);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
  move(s, s.objects[land.id], 'graveyard');
  s = resolve(s);
  assert.ok(s.objects[o.id].preparedCopy);
  lands(s, 'Island', 1);
  s.step = 'blockers';
  const id = s.objects[o.id].preparedCopy.id;
  s = resolve(act(s, 'cast', { card: id, target: ref(s.objects[o.id]) }));
  assert.equal(s.objects[o.id].preparedCopy, undefined);
});

test('Abigale prepares only from its controller creature casts; Heroic Stanza is a paid sorcery', () => {
  let s = setup();
  const o = put(s, names['Abigale, Poet Laureate']);
  lands(s, 'Forest', 2);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: bear.id });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  const id = s.objects[o.id].preparedCopy.id;
  assert.equal(definition(s, s.objects[id]).name, 'Heroic Stanza');
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast' && a.card === id),
    false,
  );
  s = resolve(s);
  lands(s, 'Plains', 2);
  s.step = 'blockers';
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: id, target: ref(s.objects[o.id]) }).ok,
    false,
  );
  s.step = 'main2';
  s = resolve(act(s, 'cast', { card: id, target: ref(s.objects[bear.id]) }));
  assert.equal(s.objects[bear.id].plusCounters, 1);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
});

test('Emeritus of Conflict counts all casts but prepares exactly on the third', () => {
  let s = setup();
  s.catalog = createRegistry({
    ...s.catalog,
    Spark: { name: 'Spark', type: 'instant', cost: {}, effects: [] },
  });
  const o = put(s, names['Emeritus of Conflict']);
  for (let n = 1; n <= 4; n++) {
    const spell = put(s, 'Spark', 0, 'hand');
    s = act(s, 'cast', { card: spell.id });
    assert.equal(s.stack.length, n === 3 ? 2 : 1);
    if (n === 3) {
      s = resolve(s);
      assert.ok(s.objects[o.id].preparedCopy);
      unpreparePermanent(s, s.objects[o.id]);
    }
    s = resolve(s);
  }
  assert.equal(s.objects[o.id].preparedCopy, undefined);
});

test('Abundance attacks recheck eight lands; Aviator attacks need no threshold', () => {
  let s = setup();
  const abundance = enter(s, 'Emeritus of Abundance'),
    aviator = enter(s, 'Encouraging Aviator');
  unpreparePermanent(s, abundance);
  const forests = lands(s, 'Forest', 7);
  notify(s, 'attack', { object: abundance });
  assert.equal(s.stack.length, 0);
  forests.push(put(s, 'Forest'));
  notify(s, 'attack', { object: abundance });
  assert.equal(s.stack.length, 1);
  move(s, forests[0], 'hand');
  s = resolve(s);
  assert.equal(s.objects[abundance.id].preparedCopy, undefined);
  notify(s, 'attack', { object: s.objects[aviator.id] });
  s = resolve(s);
  assert.ok(s.objects[aviator.id].preparedCopy);
});

test('Joined Researchers checks hand sizes at triggering and resolution, then both players draw three', () => {
  let s = setup();
  const o = put(s, names['Joined Researchers']);
  notify(s, 'step', { step: 'end', player: 1 });
  assert.equal(s.stack.length, 0);
  const card = put(s, 'Forest', 1, 'hand');
  notify(s, 'step', { step: 'end', player: 1 });
  assert.equal(s.stack.length, 1);
  move(s, card, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
  put(s, 'Forest', 1, 'hand');
  notify(s, 'step', { step: 'end', player: 0 });
  s = resolve(s);
  const id = s.objects[o.id].preparedCopy.id;
  lands(s, 'Plains', 3);
  const before = s.players.map((p) => p.hand.length);
  s = resolve(act(s, 'cast', { card: id, target: { kind: 'player', id: 1 } }));
  assert.deepEqual(
    s.players.map((p) => p.hand.length),
    before.map((n) => n + 3),
  );
});

test('Scathing prepares only at its first main and targets only friendly creatures', () => {
  let s = setup();
  const o = put(s, names['Scathing Shadelock']),
    enemy = put(s, 'Grizzly Bears', 1);
  notify(s, 'step', { step: 'main1', player: 1 });
  notify(s, 'step', { step: 'main2', player: 0 });
  assert.equal(s.stack.length, 0);
  notify(s, 'step', { step: 'main1', player: 0 });
  s = resolve(s);
  const id = s.objects[o.id].preparedCopy.id;
  lands(s, 'Swamp', 1);
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: id, target: ref(enemy) }).ok, false);
  s = resolve(act(s, 'cast', { card: id, target: ref(s.objects[o.id]) }));
  assert.deepEqual(stats(s, s.objects[o.id]), { power: 6, toughness: 6 });
});

test('Tam prepares from own land entry only and Deep Sight draws and gains life', () => {
  let s = setup();
  const o = put(s, names['Tam, Observant Sequencer']);
  const enemy = put(s, 'Island', 1, 'hand');
  enterBattlefieldBatch(s, [{ object: enemy, controller: 1 }]);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  const land = put(s, 'Forest', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: land }]);
  stabilize(s);
  s = resolve(s);
  lands(s, 'Island', 1);
  const before = s.players[0].hand.length;
  s = resolve(act(s, 'cast', { card: s.objects[o.id].preparedCopy.id }));
  assert.equal(s.players[0].hand.length, before + 1);
  assert.equal(s.players[0].life, 21);
});

test('Woodwork creates the shared Heartwood token with both mana options', () => {
  let s = setup();
  const o = put(s, names['Woodwork Prodigy']);
  notify(s, 'step', { step: 'upkeep', player: 0 });
  s = resolve(s);
  lands(s, 'Forest', 3);
  s = resolve(act(s, 'cast', { card: s.objects[o.id].preparedCopy.id }));
  const token = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Heartwood',
  );
  assert.ok(token?.token);
  assert.deepEqual(definition(s, token).color, ['R', 'G']);
  assert.deepEqual(definition(s, token).subtypes, ['Heartwood']);
  assert.deepEqual(definition(s, token).mana, ['R', 'G']);
});

test('prepared X spell validates in its own cost context and uses chosen X when cast', () => {
  let s = setup();
  const o = enter(s, 'Infirmary Healer'),
    id = o.preparedCopy.id;
  lands(s, 'Forest', 5);
  s = resolve(act(s, 'cast', { card: id, x: 4, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].life, 24);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
  const invalid = structuredClone(definitions[names['Infirmary Healer']]);
  delete invalid.prepareSpell.cost.X;
  assert.throws(() => createRegistry([invalid]), /X expressions require an X mana cost/);
  const noLeak = structuredClone(definitions[names['Infirmary Healer']]);
  noLeak.etb = [{ op: 'gainLife', amount: { kind: 'x' } }];
  assert.throws(() => createRegistry([noLeak]), /X expressions require an X mana cost/);
});

test('consumed preparation stays consumed after its only target leaves', () => {
  let s = setup();
  const o = enter(s, 'Infirmary Healer'),
    aviator = put(s, names['Encouraging Aviator']);
  preparePermanent(s, aviator);
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: aviator.preparedCopy.id, target: ref(o) });
  move(s, s.objects[o.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[aviator.id].preparedCopy, undefined);
});

test('prepare, cast, unprepare and prepare-again replay exactly with embedded definitions', () => {
  const scholar = {
    name: 'Replay Preparation',
    type: 'creature',
    cost: {},
    power: 1,
    toughness: 3,
    mainName: 'Replay Preparation',
    keywords: ['flash'],
    prepareSpell: {
      name: 'Replay Lesson',
      type: 'instant',
      cost: {},
      effects: [{ op: 'gainLife', amount: 2 }],
    },
    activated: [
      { cost: {}, effects: [{ op: 'prepare', subject: 'source' }] },
      { cost: {}, effects: [{ op: 'unprepare', subject: 'source' }] },
    ],
  };
  const catalog = createRegistry({ ...CARDS, [scholar.name]: scholar });
  const deck = [...Array(4).fill(scholar.name), ...Array(8).fill('Forest')];
  let s = createGame({ catalog, decks: [deck, deck], minimumDeckSize: 0, mulligan: false });
  const id = s.players[0].hand.find((id) => s.objects[id].name === scholar.name);
  assert.ok(id);
  s = resolve(act(s, 'cast', { card: id }));
  s = resolve(act(s, 'activate', { card: id, ability: 0 }));
  s = resolve(act(s, 'cast', { card: s.objects[id].preparedCopy.id }));
  assert.equal(s.players[0].life, 22);
  s = resolve(act(s, 'activate', { card: id, ability: 0 }));
  const old = s.objects[id].preparedCopy.id;
  s = resolve(act(s, 'activate', { card: id, ability: 1 }));
  assert.equal(s.objects[old], undefined);
  s = resolve(act(s, 'activate', { card: id, ability: 0 }));
  assert.notEqual(s.objects[id].preparedCopy.id, old);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});

test('shared spell names keep independent copies, controllers and preparation lifecycles', () => {
  let s = setup();
  const a = put(s, names['Stingerquill Voxmancer']),
    b = put(s, names['Stingerquill Voxmancer'], 1);
  preparePermanent(s, a);
  preparePermanent(s, b);
  const first = a.preparedCopy.id,
    second = b.preparedCopy.id;
  assert.notEqual(first, second);
  assert.equal(s.objects[first].name, s.objects[second].name);
  assert.equal(playableCards(s, 0).includes(second), false);
  lands(s, 'Swamp', 1);
  s = resolve(act(s, 'cast', { card: first, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].life, 19);
  assert.equal(s.objects[a.id].preparedCopy, undefined);
  assert.equal(s.objects[b.id].preparedCopy.id, second);
  assert.equal(playableCards(s, 1).includes(second), true);
});

test('a stale Waypoint target does not prepare its new incarnation', () => {
  let s = setup();
  const land = put(s, names['Skycoach Waypoint']),
    o = put(s, names['Encouraging Aviator']);
  lands(s, 'Forest', 3);
  s = act(s, 'activate', { card: land.id, ability: 0, target: ref(o) });
  move(s, s.objects[o.id], 'exile');
  enterBattlefieldBatch(s, [{ object: s.objects[o.id] }]);
  s = resolve(s);
  assert.equal(s.objects[o.id].preparedCopy, undefined);
});

test('group-bound prepare/unprepare validates authoring and operates independently on each target', () => {
  const s = setup();
  const a = put(s, names['Stingerquill Voxmancer']),
    b = put(s, names['Encouraging Aviator']);
  const def = {
    name: 'Group Preparation',
    type: 'instant',
    cost: {},
    targetGroups: [
      {
        id: 'students',
        selector: { scope: 'permanent', where: { type: 'creature' } },
        min: 1,
        max: 2,
      },
    ],
    effects: [
      { op: 'prepare', targetGroup: 'students' },
      { op: 'unprepare', targetGroup: 'students' },
      { op: 'prepare', targetGroup: 'students' },
    ],
  };
  createRegistry([def]);
  const source = sourceFromDefinition(
    { text: '', color: [], keywords: [], subtypes: [], ...def },
    { id: 'leyline:test/group-preparation' },
  );
  const schema = JSON.parse(
    readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const valid = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(valid(source), true, JSON.stringify(valid.errors));
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  resolveEffects(s, {
    controller: 0,
    source: ref(a),
    targets: { students: [ref(a), ref(b)] },
    effects: result.definition.effects,
  });
  assert.ok(a.preparedCopy);
  assert.ok(b.preparedCopy);
  assert.notEqual(a.preparedCopy.id, b.preparedCopy.id);
  stabilize(s);
  assert.equal(s.players[0].exile.length, 2);
});

test('Regrowth returns any own graveyard card and Lightning Bolt deals its full three damage', () => {
  let s = setup();
  const abundance = enter(s, 'Emeritus of Abundance'),
    conflict = put(s, names['Emeritus of Conflict']);
  const card = put(s, 'Forest', 0, 'graveyard');
  lands(s, 'Forest', 2);
  s = resolve(act(s, 'cast', { card: abundance.preparedCopy.id, target: ref(card) }));
  assert.equal(s.objects[card.id].zone, 'hand');
  preparePermanent(s, s.objects[conflict.id]);
  lands(s, 'Mountain', 1);
  s = resolve(
    act(s, 'cast', {
      card: s.objects[conflict.id].preparedCopy.id,
      target: { kind: 'player', id: 1 },
    }),
  );
  assert.equal(s.players[1].life, 17);
});

test('a prepared spell cast as the third spell consumes the old copy before re-preparing its source', () => {
  let s = setup();
  s.catalog = createRegistry({
    ...s.catalog,
    Spark: { name: 'Spark', type: 'instant', cost: {}, effects: [] },
  });
  const source = put(s, names['Emeritus of Conflict']);
  preparePermanent(s, source);
  const first = source.preparedCopy.id;
  for (let n = 0; n < 2; n++) {
    const spark = put(s, 'Spark', 0, 'hand');
    s = resolve(act(s, 'cast', { card: spark.id }));
  }
  lands(s, 'Mountain', 1);
  s = act(s, 'cast', { card: first, target: { kind: 'player', id: 1 } });
  assert.equal(s.objects[source.id].preparedCopy, undefined);
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  const second = s.objects[source.id].preparedCopy.id;
  assert.notEqual(first, second);
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
  assert.equal(s.objects[first], undefined);
  assert.equal(s.objects[source.id].preparedCopy.id, second);
});
