import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CARDS,
  createRegistry,
  definition,
  dispatch,
  ref,
  playerView,
  legalActions,
} from '../src/index.js';
import { addModifier, move, copiableDefinition } from '../src/model.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const sources = ['hunter-s-talent', 'stormchaser-s-talent', 'otter-prowess-token'].map((slug) =>
  JSON.parse(fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url))),
);
const mechanics = JSON.parse(
  fs.readFileSync(new URL('../../cards/mechanics.json', import.meta.url)),
);
const identities = Object.fromEntries(sources.map((s) => [s.id, s.name]));
const definitions = sources.map((source) => {
  const result = compileCard(source, { mechanics, identities });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.definition;
});
const registry = createRegistry({
  ...CARDS,
  ...Object.fromEntries(definitions.map((d) => [d.name, d])),
});
function setup() {
  const s = fixture();
  s.catalog = registry;
  lands(s, 'Forest', 8);
  lands(s, 'Island', 12);
  return s;
}
const level = (s, source, ability = 0) => resolve(act(s, 'activate', { card: source.id, ability }));
const damageBonus = (amount) => ({ amount, where: { type: 'creature' } });

test('Class native conversion does not copy base keywords or unrelated abilities into acquired grants', () => {
  const d = {
    ...definitions[0],
    keywords: ['flash'],
    ward: { mana: { generic: 1 } },
    cantPreventDamage: true,
  };
  assert.doesNotThrow(() => createRegistry([d]));
  const source = sourceFromDefinition(d, { id: sources[0].id });
  const result = compileCard(source, { mechanics, identities });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition, d);
});

test('Class cumulative damage replacements fail closed rather than overwrite earlier abilities', () => {
  for (const topLevel of [true, false]) {
    const d = structuredClone(definitions[0]);
    if (topLevel) d.damageBonus = damageBonus(1);
    d.classLevels[0].abilities = { damageBonus: damageBonus(2) };
    if (!topLevel) d.classLevels[1].abilities = { damageBonus: damageBonus(3) };
    assert.throws(() => createRegistry([d]), /multiple simultaneous damage/);
  }
  const source = structuredClone(sources[0]);
  source.abilities[1].abilities = [1, 2].map((amount) => ({
    kind: 'damageBonus',
    ...damageBonus(amount),
  }));
  assert.equal(compileCard(source).ok, false);
});

test('Class grants on transforming back faces validate token references inside every nested branch', () => {
  const back = structuredClone(definitions[0]);
  back.classLevels[0].abilities = {
    activated: [
      {
        cost: {},
        effects: [
          {
            op: 'conditional',
            condition: { kind: 'controlAtLeast', count: 1, where: { type: 'creature' } },
            then: [{ op: 'token', definition: 'Missing class token', count: 1 }],
          },
        ],
      },
    ],
  };
  const front = {
    name: 'Class front',
    type: 'artifact',
    cost: {},
    frontName: 'Class front',
    backFace: back,
  };
  assert.throws(() => createRegistry([front]), /missing token definition Missing class token/);
  const token = {
    name: 'Missing class token',
    type: 'creature',
    cost: {},
    power: 1,
    toughness: 1,
    token: true,
  };
  assert.doesNotThrow(() => createRegistry([front, token]));
});

test('Class fragment compilation preserves a costless transforming back face context', () => {
  const front = {
    name: 'Transforming class front',
    type: 'artifact',
    cost: { generic: 2 },
    frontName: 'Transforming class front',
    backFace: { ...definitions[0], cost: {} },
  };
  const native = createRegistry([front])[front.name];
  const source = sourceFromDefinition(native, { id: 'leyline:test/transforming-class' });
  assert.equal(source.abilities[0].back.characteristics.manaCost, null);
  const result = compileCard(source);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition.backFace.classLevels, native.backFace.classLevels);
});

test('Class native nesting and effect cross-references fail before play begins', () => {
  const nested = structuredClone(definitions[0]);
  nested.classLevels[0].abilities.classLevels = structuredClone(nested.classLevels);
  assert.throws(() => createRegistry([nested]), /supported ability fragment/);
  const missing = structuredClone(definitions[0]);
  missing.classLevels[1].abilities = {
    triggers: [
      {
        event: { event: 'classLevel', object: 'source', classLevel: 3 },
        modes: [
          { label: 'Life', effects: [{ op: 'gainLife', amount: 1 }] },
          { label: 'Token', effects: [{ op: 'token', definition: 'Unknown', count: 1 }] },
        ],
      },
    ],
  };
  assert.throws(() => createRegistry([missing]), /missing token definition Unknown/);
});

test('Class pending level advancement uses current controller for only its own level trigger', () => {
  let s = setup();
  const source = put(s, "Stormchaser's Talent"),
    other = put(s, "Stormchaser's Talent", 1);
  s.objects[other.id].classLevel = 2;
  const mine = put(s, 'Opt', 0, 'graveyard'),
    theirs = put(s, 'Opt', 1, 'graveyard');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  s.objects[source.id].controller = 1;
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 1, target: ref(mine) }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(theirs) });
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].controller, 1);
  s.objects[source.id].controller = 0;
  s = resolve(s);
  assert.equal(s.objects[theirs.id].zone, 'hand');
  assert.equal(s.objects[mine.id].zone, 'graveyard');
});

test('A Class retains its designation through copy/type changes without triggering level events', () => {
  let s = setup();
  const source = put(s, "Hunter's Talent");
  s = level(s, source);
  s.objects[source.id].definitionOverride = structuredClone(registry["Stormchaser's Talent"]);
  assert.equal(s.objects[source.id].classLevel, 2);
  assert.equal(definition(s, s.objects[source.id]).triggers.length, 1);
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.choice, null);
  addModifier(s, {
    objectId: source.id,
    incarnation: source.incarnation,
    landForm: { mana: ['G'] },
    expires: s.turn,
  });
  assert.equal(definition(s, s.objects[source.id]).type, 'land');
  assert.equal(s.objects[source.id].classLevel, 2);
  assert.equal(copiableDefinition(s, s.objects[source.id]).classLevel, undefined);
  assert.ok(
    legalActions(playerView(s, 0), 0).some(
      (a) => a.type === 'activate' && a.card === source.id && a.ability === 1,
    ),
  );
});

test('Hunter entry requires both still-legal targets including original control relations', () => {
  for (const invalid of ['actor-control', 'victim-control', 'actor-reincarnated']) {
    let s = setup();
    const source = put(s, "Hunter's Talent", 0, 'hand'),
      actor = put(s, 'Grizzly Bears'),
      victim = put(s, 'Grizzly Bears', 1);
    enterBattlefield(s, source);
    stabilize(s);
    s = act(s, 'chooseTriggerTargets', {
      targets: { actor: [ref(actor)], victims: [ref(victim)] },
    });
    if (invalid === 'actor-control') s.objects[actor.id].controller = 1;
    else if (invalid === 'victim-control') s.objects[victim.id].controller = 0;
    else {
      move(s, s.objects[actor.id], 'hand');
      move(s, s.objects[actor.id], 'battlefield');
    }
    s = resolve(s);
    assert.equal(s.objects[victim.id].zone, 'battlefield', invalid);
    assert.equal(s.objects[victim.id].damage, 0, invalid);
  }
});

test('Stormchaser level trigger rejects reincarnated targets and does not fire through ability loss', () => {
  let s = setup();
  const source = put(s, "Stormchaser's Talent"),
    target = put(s, 'Opt', 0, 'graveyard');
  s = level(s, source);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  move(s, s.objects[target.id], 'hand');
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  const second = put(s, "Stormchaser's Talent");
  s = act(s, 'activate', { card: second.id, ability: 0 });
  addModifier(s, {
    objectId: second.id,
    incarnation: second.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  s = resolve(s);
  assert.equal(s.objects[second.id].classLevel, 2);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  s.modifiers = [];
  assert.equal(s.pendingTriggers.length, 0);
});
