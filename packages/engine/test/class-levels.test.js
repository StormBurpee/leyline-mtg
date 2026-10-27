import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  createRegistry,
  createGame,
  definition,
  dispatch,
  abilityProblem,
  legalActions,
  playerView,
  chooseBotCommand,
  ref,
  stats,
  keywords,
  exportReplay,
  replay,
} from '../src/index.js';
import { classLevel } from '../src/class-levels.js';
import {
  addModifier,
  addObject,
  move,
  notifyTriggers,
  copiableDefinition,
  counterKinds,
} from '../src/model.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { declareAttackers } from '../src/combat.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { activatedAbilityButtons } from '../../../apps/web/ability-controls.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const slugs = ['hunter-s-talent', 'stormchaser-s-talent', 'otter-prowess-token'];
const sources = slugs.map((slug) =>
  JSON.parse(fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url))),
);
const mechanics = JSON.parse(
  fs.readFileSync(new URL('../../cards/mechanics.json', import.meta.url)),
);
const identities = Object.fromEntries(sources.map((source) => [source.id, source.name]));
const definitions = sources.map((source) => {
  const result = compileCard(source, { mechanics, identities });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.definition;
});
const probe = {
  name: 'Class probe',
  type: 'enchantment',
  types: ['enchantment'],
  subtypes: ['Class'],
  cost: {},
  activated: [{ cost: {}, effects: [{ op: 'gainLife', amount: 1 }] }],
  classLevels: [
    {
      level: 2,
      cost: {},
      abilities: {
        static: { kind: 'anthem', power: 1, toughness: 1 },
        activated: [{ cost: {}, effects: [{ op: 'gainLife', amount: 2 }] }],
        triggers: [
          {
            event: { event: 'step', step: 'end', controller: 'you' },
            effects: [{ op: 'draw', count: 1 }],
          },
        ],
      },
    },
    {
      level: 3,
      cost: {},
      abilities: { activated: [{ cost: {}, effects: [{ op: 'gainLife', amount: 3 }] }] },
    },
  ],
};
const registry = createRegistry({
  ...CARDS,
  ...Object.fromEntries(definitions.map((d) => [d.name, d])),
  [probe.name]: probe,
});
function setup() {
  const s = fixture();
  s.catalog = registry;
  lands(s, 'Forest', 10);
  lands(s, 'Island', 12);
  return s;
}
function level(s, object, index = 0) {
  return resolve(act(s, 'activate', { card: object.id, ability: index }));
}
function reject(s, command) {
  const before = JSON.stringify(s);
  assert.equal(dispatch(s, { player: s.priority, ...command }).ok, false);
  assert.equal(JSON.stringify(s), before);
}
test('complete Class sources validate and roundtrip; missing or nested level bars fail closed', () => {
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(fs.readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url))),
  );
  for (const [index, source] of sources.entries()) {
    assert.ok(validate(source), JSON.stringify(validate.errors));
    const roundtrip = compileCard(
      sourceFromDefinition(definitions[index], {
        id: source.id,
        idsByName: Object.fromEntries(sources.map((s) => [s.name, s.id])),
      }),
      { mechanics, identities },
    );
    assert.ok(roundtrip.ok, JSON.stringify(roundtrip.diagnostics));
    assert.deepEqual(roundtrip.definition, definitions[index]);
  }
  for (const mutate of [
    (s) => s.abilities.pop(),
    (s) => (s.abilities[1].level = 3),
    (s) => (s.abilities[1].abilities = [structuredClone(s.abilities[2])]),
  ]) {
    const source = structuredClone(sources[0]);
    mutate(source);
    assert.equal(compileCard(source).ok, false);
  }
  assert.throws(
    () =>
      createRegistry({
        Bad: { ...probe, name: 'Bad', classLevels: [{ ...probe.classLevels[0], level: 7 }] },
      }),
    /complete level/,
  );
});
test('Class progression is sequential, sorcery-speed, paid before resolution, and not a counter', () => {
  let s = setup();
  const source = put(s, "Hunter's Talent");
  assert.equal(classLevel(source), 1);
  assert.deepEqual(counterKinds(source), []);
  reject(s, { type: 'activate', card: source.id, ability: 1 });
  s.step = 'end';
  reject(s, { type: 'activate', card: source.id, ability: 0 });
  s.step = 'main1';
  const manaBefore = Object.values(s.objects).filter((o) => o.tapped).length;
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(classLevel(s.objects[source.id]), 1);
  assert.equal(s.stack.at(-1).effects[0].op, 'setClassLevel');
  assert.equal(Object.values(s.objects).filter((o) => o.tapped).length, manaBefore + 2);
  reject(s, { type: 'activate', card: source.id, ability: 0 });
  s = resolve(s);
  assert.equal(classLevel(s.objects[source.id]), 2);
  reject(s, { type: 'activate', card: source.id, ability: 0 });
  s = level(s, source, 1);
  assert.equal(classLevel(s.objects[source.id]), 3);
  assert.deepEqual(counterKinds(s.objects[source.id]), []);
  reject(s, { type: 'activate', card: source.id, ability: 1 });
});
test('countered Class level activation consumes mana but neither advances nor grants effects', () => {
  let s = setup();
  const source = put(s, "Hunter's Talent");
  lands(s, 'Island', 3, 1);
  s = act(s, 'activate', { card: source.id, ability: 0 });
  const ability = s.stack[0];
  s = act(s, 'pass');
  // Use a bounded custom counter ability spell so the test is independent of card variants.
  const counter = {
    name: 'Level counter',
    type: 'instant',
    cost: {},
    target: { scope: 'ability' },
    effects: [{ op: 'counterAbility' }],
  };
  s.catalog = createRegistry({ ...registry, [counter.name]: counter });
  const card = put(s, counter.name, 1, 'hand');
  s = act(s, 'cast', { card: card.id, target: { kind: 'stack', id: ability.id } });
  s = resolve(s);
  assert.equal(classLevel(s.objects[source.id]), 1);
  assert.equal(s.stack.length, 0);
  assert.equal(definition(s, s.objects[source.id]).triggers.length, 1);
});
test('departing and re-entering source invalidates the queued level ability, while control changes do not', () => {
  let s = setup();
  const source = put(s, 'Class probe');
  s = act(s, 'activate', { card: source.id, ability: 1 });
  move(s, s.objects[source.id], 'hand');
  move(s, s.objects[source.id], 'battlefield');
  s = resolve(s);
  assert.equal(classLevel(s.objects[source.id]), 1);
  s = act(s, 'activate', { card: source.id, ability: 1 });
  s.objects[source.id].controller = 1;
  s = resolve(s);
  assert.equal(classLevel(s.objects[source.id]), 2);
  assert.equal(s.objects[source.id].controller, 1);
});
test('ability loss retains designation, blocks level bars, and restores acquired abilities afterward', () => {
  let s = setup();
  const source = put(s, 'Class probe'),
    creature = put(s, 'Grizzly Bears');
  s = level(s, source, 1);
  assert.equal(stats(s, s.objects[creature.id]).power, 3);
  addModifier(s, {
    objectId: source.id,
    incarnation: source.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.equal(classLevel(s.objects[source.id]), 2);
  assert.equal(definition(s, s.objects[source.id]).activated, undefined);
  assert.equal(stats(s, s.objects[creature.id]).power, 2);
  reject(s, { type: 'activate', card: source.id, ability: 2 });
  s.modifiers = [];
  assert.equal(definition(s, s.objects[source.id]).activated[3].effects[0].amount, 2);
  assert.equal(stats(s, s.objects[creature.id]).power, 3);
});
test('already activated level ability advances even after ability loss, but gains no live abilities until restored', () => {
  let s = setup();
  const source = put(s, 'Class probe');
  s = act(s, 'activate', { card: source.id, ability: 1 });
  addModifier(s, {
    objectId: source.id,
    incarnation: source.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  s = resolve(s);
  assert.equal(classLevel(s.objects[source.id]), 2);
  assert.equal(definition(s, s.objects[source.id]).static, undefined);
  s.modifiers = [];
  assert.ok(definition(s, s.objects[source.id]).static);
});
test('copy values omit Class designation; copied new permanent starts at level 1', () => {
  let s = setup();
  const source = put(s, 'Class probe');
  s = level(s, source, 1);
  s = level(s, source, 2);
  const copy = addObject(
    s,
    'Class probe',
    0,
    'battlefield',
    structuredClone(copiableDefinition(s, s.objects[source.id])),
  );
  copy.token = true;
  assert.equal(classLevel(copy), 1);
  assert.equal(definition(s, copy).static, undefined);
  assert.equal(classLevel(s.objects[source.id]), 3);
});
test('Class-granted activations have stable command slots through every later level', () => {
  let s = setup();
  const source = put(s, 'Class probe');
  assert.equal(definition(s, source).activated.length, 3);
  reject(s, { type: 'activate', card: source.id, ability: 3 });
  s = level(s, source, 1);
  assert.equal(definition(s, s.objects[source.id]).activated.length, 4);
  s = level(s, source, 2);
  assert.equal(definition(s, s.objects[source.id]).activated.length, 5);
  s = resolve(act(s, 'activate', { card: source.id, ability: 3 }));
  assert.equal(s.players[0].life, 22);
});
test('Class-granted triggers survive source departure instead of acquiring false intervening-if', () => {
  let s = setup();
  const source = put(s, 'Class probe');
  s = level(s, source, 1);
  notifyTriggers(s, 'step', { step: 'end', player: 0 });
  stabilize(s);
  assert.equal(s.stack.length, 1);
  move(s, s.objects[source.id], 'graveyard');
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 1);
});
test('Stormchaser becomes-level trigger targets at trigger placement and retains its controller after source loss', () => {
  let s = setup();
  const source = put(s, "Stormchaser's Talent"),
    spell = put(s, 'Opt', 0, 'graveyard');
  s = level(s, source);
  assert.equal(classLevel(s.objects[source.id]), 2);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(spell) });
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'hand');
  assert.equal(classLevel(s.objects[source.id]), 1);
});
test('Stormchaser level 3 token trigger survives countered triggering spell and source removal', () => {
  let s = setup();
  const source = put(s, "Stormchaser's Talent");
  s = level(s, source);
  s = level(s, source, 1);
  const spell = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.stack.length, 2);
  s.stack.shift();
  move(s, s.objects[spell.id], 'graveyard');
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Otter Prowess Token' && o.zone === 'battlefield',
  );
  assert.ok(token);
  assert.equal(stats(s, token).power, 1);
  const second = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: second.id });
  s = resolve(s);
  assert.equal(stats(s, s.objects[token.id]).power, 2);
});
test('Hunter attack grant unlocks at level 2, keeps legal attacking targets, and resolves after source loss', () => {
  let s = setup();
  const source = put(s, "Hunter's Talent"),
    bear = put(s, 'Grizzly Bears');
  s = level(s, source);
  s.step = 'attackers';
  declareAttackers(s, [bear.id]);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.ok(keywords(s, s.objects[bear.id]).includes('trample'));
});
test('Hunter end-step condition remains a real intervening-if independent of Class level/source presence', () => {
  let s = setup();
  const source = put(s, "Hunter's Talent"),
    bear = put(s, 'Grizzly Bears');
  s = level(s, source);
  s = level(s, source, 1);
  notifyTriggers(s, 'step', { step: 'end', player: 0 });
  assert.equal(s.pendingTriggers.length, 0);
  s.objects[bear.id].plusCounters = 2;
  notifyTriggers(s, 'step', { step: 'end', player: 0 });
  stabilize(s);
  const before = s.players[0].hand.length;
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 1);
});
test('Class level and cost UI are readable and opaque bot command remains legal', () => {
  const s = setup(),
    source = put(s, "Hunter's Talent");
  const view = playerView(s, 0);
  const actions = legalActions(view, 0);
  const html = activatedAbilityButtons(view, 0, view.objects[source.id], actions);
  assert.match(html, /\{1\}\{G\}: Level 2/);
  assert.match(html, /must be level 2/);
  const command = chooseBotCommand(view, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.ability, 0);
  assert.equal(dispatch(s, command).ok, true);
});
test('free Class progression roundtrips through deterministic embedded-catalog replay', () => {
  let s = createGame({
    catalog: registry,
    mulligan: false,
    minimumDeckSize: 0,
    decks: [
      ['Class probe', 'Class probe', 'Class probe', 'Class probe', ...Array(7).fill('Forest')],
      Array(12).fill('Island'),
    ],
    seed: 3,
  });
  while (s.step !== 'main1') s = resolve(s);
  const card = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === 'Class probe');
  assert.ok(card);
  s = resolve(act(s, 'cast', { card: card.id }));
  s = level(s, card, 1);
  s = level(s, card, 2);
  const result = replay(exportReplay(s));
  assert.deepEqual(result, s);
});
test('Hunter entry chooses two groups before priority and uses legal creature power after Class departure', () => {
  let s = setup();
  const hunter = put(s, "Hunter's Talent", 0, 'hand'),
    bear = put(s, 'Grizzly Bears'),
    victim = put(s, 'Grizzly Bears', 1);
  enterBattlefield(s, hunter);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { actor: [ref(bear)], victims: [ref(victim)] } });
  move(s, s.objects[hunter.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(s.objects[bear.id].damage, 0);
});
test('Stormchaser entry token has exact blue-red Otter characteristics and only existing tokens get prowess', () => {
  let s = setup();
  const source = put(s, "Stormchaser's Talent", 0, 'hand');
  enterBattlefield(s, source);
  stabilize(s);
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Otter Prowess Token' && o.zone === 'battlefield',
  );
  assert.ok(token);
  assert.deepEqual(definition(s, token).color, ['U', 'R']);
  assert.deepEqual(definition(s, token).subtypes, ['Otter']);
  s = level(s, source);
  s = level(s, source, 1);
  const spell = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  while (s.choice) s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  while (s.stack.length > 1) s = resolve(s);
  const tokens = Object.values(s.objects).filter(
    (o) => o.name === 'Otter Prowess Token' && o.zone === 'battlefield',
  );
  assert.equal(tokens.length, 2);
  assert.equal(stats(s, s.objects[token.id]).power, 2);
  assert.equal(
    stats(
      s,
      tokens.find((o) => o.id !== token.id),
    ).power,
    1,
  );
});
test('Hunter end-step draw is countermanded when its actual power condition stops being true', () => {
  let s = setup();
  const source = put(s, "Hunter's Talent"),
    bear = put(s, 'Grizzly Bears');
  s = level(s, source);
  s = level(s, source, 1);
  s.objects[bear.id].plusCounters = 2;
  notifyTriggers(s, 'step', { step: 'end', player: 0 });
  stabilize(s);
  s.objects[bear.id].plusCounters = 0;
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before);
});
