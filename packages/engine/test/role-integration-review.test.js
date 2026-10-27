import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, createGame, createRegistry } from '../src/index.js';
import { compilePack } from '../../cards/pack.js';
import {
  addObject,
  addModifier,
  ref,
  move,
  stats,
  wardCosts,
  definition,
  copiableDefinition,
} from '../src/model.js';
import { enterBattlefield, stabilize, resolveTop } from '../src/effects.js';
import { act, resolve } from './helpers.js';
const files = [
  ...['cursed', 'monster', 'royal', 'sorcerer', 'wicked', 'young-hero'].map(
    (role) => `${role}-role`,
  ),
  'cursed-courtier',
  'spiteful-hexmage',
  'not-dead-after-all',
  'return-triumphant',
  'living-lectern',
  'cut-in',
  'hunter-s-axe',
];
const sources = files.map((name) =>
  JSON.parse(readFileSync(new URL(`../../cards/cards/${name}.json`, import.meta.url))),
);
const pack = compilePack(sources);
assert(pack.ok, JSON.stringify(pack.diagnostics));
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(pack.definitions.map((d) => [d.name, d])),
});
function fixture() {
  const s = createGame({ catalog, mulligan: false });
  s.turn = 3;
  s.step = 'main1';
  for (const p of s.players) {
    for (const id of [...p.hand]) move(s, s.objects[id], 'library');
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[c] = 100;
  }
  return s;
}
const put = (s, name, player = 0, zone = 'battlefield') => addObject(s, name, player, zone);
const roles = (s, target) =>
  Object.values(s.objects).filter(
    (o) =>
      o.zone === 'battlefield' &&
      definition(s, o).subtypes.includes('Role') &&
      (!target || o.attachedTo?.id === target.id),
  );
function role(s, name, target, player = 0) {
  const token = put(s, name, player, 'void');
  enterBattlefield(s, token, player, ref(target));
  return token;
}

test('review: changing control groups Roles by current controller but preserves original attachment timestamps and owners', () => {
  const s = fixture(),
    bearer = put(s, 'Grizzly Bears');
  const old = role(s, 'Wicked', bearer, 1),
    newest = role(s, 'Royal', bearer, 0);
  old.controller = 0;
  stabilize(s);
  assert.equal(roles(s, bearer).length, 1);
  assert.equal(roles(s, bearer)[0].id, newest.id);
  assert.equal(old.owner, 1);
  assert.equal(
    s.events.some((e) => e.type === 'sacrificed' && e.objectId === old.id),
    false,
  );
  assert.equal(s.stack[0].controller, 0);
  resolveTop(s);
  assert.equal(s.players[1].life, 19);
  assert.equal(s.players[0].life, 20);
});

test('review: lethal Cut In still creates its selected Role before state-based actions remove both recipient and Aura', () => {
  let s = fixture();
  const bearer = put(s, 'Grizzly Bears'),
    spell = put(s, 'Cut In', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { victim: [ref(bearer)], hero: [ref(bearer)] } });
  s = resolve(s);
  assert.equal(s.objects[bearer.id].zone, 'graveyard');
  assert.equal(roles(s).length, 0);
  assert.equal(
    s.events.filter(
      (e) => e.type === 'zoneChange' && e.to === 'battlefield' && e.name === 'Young Hero',
    ).length,
    1,
  );
});

test('review: Lectern with an announced but now illegal recipient does not draw, unlike deliberately choosing zero recipients', () => {
  for (const targeted of [false, true]) {
    let s = fixture();
    const lectern = put(s, 'Living Lectern'),
      bearer = put(s, 'Grizzly Bears');
    s = act(s, 'activate', {
      card: lectern.id,
      ability: 0,
      targets: { recipient: targeted ? [ref(bearer)] : [] },
    });
    move(s, s.objects[bearer.id], 'exile');
    s = resolve(s);
    assert.equal(s.players[0].hand.length, targeted ? 0 : 1);
    assert.equal(roles(s).length, 0);
  }
});

test('review: Return Triumphant attaches before the returned Hexmage ETB and its later Curse replaces that exact Hero', () => {
  let s = fixture();
  const bearer = put(s, 'Spiteful Hexmage', 0, 'graveyard'),
    spell = put(s, 'Return Triumphant', 0, 'hand');
  const old = ref(bearer);
  s = resolve(act(s, 'cast', { card: spell.id, target: old }));
  assert.equal(s.choice.kind, 'triggerTarget');
  const hero = roles(s, bearer)[0];
  assert.equal(hero.name, 'Young Hero');
  assert.notEqual(hero.attachedTo.incarnation, old.incarnation);
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[bearer.id]) });
  s = resolve(s);
  assert.deepEqual(
    roles(s, bearer).map((o) => o.name),
    ['Cursed'],
  );
  assert.deepEqual(stats(s, s.objects[bearer.id]), { power: 1, toughness: 1 });
});

test('review: a stolen Courtier returns with death-controller Wicked and owner-controlled Cursed without conflicting Roles', () => {
  let s = fixture();
  const bearer = put(s, 'Cursed Courtier', 1),
    spell = put(s, 'Not Dead After All', 0, 'hand');
  bearer.controller = 0;
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(bearer) }));
  move(s, s.objects[bearer.id], 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[bearer.id].controller, 1);
  assert.equal(s.objects[bearer.id].tapped, true);
  assert.deepEqual(
    roles(s, bearer).map((o) => [o.name, o.controller]),
    [['Wicked', 0]],
  );
  s = resolve(s);
  assert.deepEqual(
    roles(s, bearer).map((o) => [o.name, o.controller]),
    [
      ['Wicked', 0],
      ['Cursed', 1],
    ],
  );
  assert.deepEqual(stats(s, s.objects[bearer.id]), { power: 2, toughness: 2 });
});

test('review: reequipping an existing Axe after ability loss refreshes its creature-owned grant without copying it', () => {
  let s = fixture();
  const bearer = put(s, 'Grizzly Bears'),
    axe = put(s, "Hunter's Axe");
  s = resolve(act(s, 'activate', { card: axe.id, ability: 0, target: ref(bearer) }));
  addModifier(s, {
    objectId: bearer.id,
    incarnation: bearer.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.equal(definition(s, s.objects[bearer.id]).triggers, undefined);
  s = resolve(act(s, 'activate', { card: axe.id, ability: 0, target: ref(s.objects[bearer.id]) }));
  assert.equal(definition(s, s.objects[bearer.id]).triggers.length, 1);
  assert.equal(copiableDefinition(s, s.objects[bearer.id]).triggers, undefined);
  assert.equal(stats(s, s.objects[bearer.id]).power, 4);
});

test('review: both Royal wards survive opposite-controller Roles and vanish independently on attachment loss', () => {
  const s = fixture(),
    bearer = put(s, 'Grizzly Bears');
  bearer.definitionOverride = { ...CARDS['Grizzly Bears'], ward: { mana: { generic: 2 } } };
  const first = role(s, 'Royal', bearer, 0),
    second = role(s, 'Royal', bearer, 1);
  stabilize(s);
  assert.deepEqual(wardCosts(s, bearer), [
    { mana: { generic: 2 } },
    { mana: { generic: 1 } },
    { mana: { generic: 1 } },
  ]);
  move(s, first, 'graveyard');
  assert.equal(wardCosts(s, bearer).length, 2);
  move(s, second, 'graveyard');
  assert.deepEqual(wardCosts(s, bearer), [{ mana: { generic: 2 } }]);
});

test('review: recursive choice linker traverses attachment grants rather than accepting hidden invalid Role references', () => {
  const source = structuredClone(sources.find((s) => s.name === 'Sorcerer'));
  const notAura = structuredClone(sources.find((s) => s.name === 'Monster'));
  notAura.abilities = [];
  source.abilities.at(-1).effects = [
    {
      op: 'chooseEffect',
      options: [
        { label: 'Do nothing', effects: [] },
        {
          label: 'Attempt illegal Role',
          effects: [{ op: 'createAttachedToken', token: notAura.id, target: 'source' }],
        },
      ],
    },
  ];
  const result = compilePack([source, notAura]);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((d) => d.code === 'ATTACHED_TOKEN_REFERENCE'));
  const native = structuredClone(catalog.Sorcerer);
  native.attachmentTriggers[0].effects = [
    {
      op: 'chooseEffect',
      options: [
        { label: 'Do nothing', effects: [] },
        {
          label: 'Missing Role',
          effects: [{ op: 'attachedToken', definition: 'Missing Role', subject: 'source' }],
        },
      ],
    },
  ];
  assert.throws(
    () => createRegistry({ ...catalog, Sorcerer: native }),
    /missing token definition Missing Role/,
  );
});
