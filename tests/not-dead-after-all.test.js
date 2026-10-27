import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  ref,
  definition,
} from '../packages/engine/src/index.js';
import { addObject, addModifier, copiableDefinition, move } from '../packages/engine/src/model.js';
import {
  resolveEffects,
  resolveTop,
  stabilize,
  enterBattlefield,
} from '../packages/engine/src/effects.js';
import { finishCleanup } from '../packages/engine/src/turn.js';
import { compilePack } from '../packages/cards/pack.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { act, resolve, lands } from '../packages/engine/test/helpers.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const source = read('../packages/cards/cards/not-dead-after-all.json'),
  token = read('../packages/cards/cards/wicked-role.json');
const oracle = read('./fixtures/not-dead-after-all-oracle-reviewed.json').cards[0];
const pack = compilePack([source, token]);
assert(pack.ok, JSON.stringify(pack.diagnostics));
const chooser = {
  ...CARDS['Llanowar Elves'],
  name: 'Returning Choice Creature',
  chooseCreatureType: true,
};
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(pack.definitions.map((d) => [d.name, d])),
  [chooser.name]: chooser,
});
function fixture() {
  const s = createGame({ catalog, mulligan: false });
  s.turn = 3;
  s.step = 'main1';
  lands(s, 'Swamp', 2);
  return s;
}
const put = (s, name, player = 0, zone = 'battlefield') => addObject(s, name, player, zone);
const roles = (s) =>
  Object.values(s.objects).filter((o) => o.name === 'Wicked' && o.zone === 'battlefield');
function grant(s, object) {
  resolveEffects(s, {
    controller: object.controller,
    source: ref(object),
    target: ref(object),
    effects: [{ op: 'grantDeathReturn', attachedToken: 'Wicked', tapped: true }],
  });
}
function die(s, object) {
  move(s, object, 'graveyard');
  stabilize(s);
}

test('Not Dead After All preserves complete Oracle source and round-trips the temporary creature-owned trigger grant', () => {
  assert.equal(source.id, oracle.oracle_id);
  assert.equal(source.rulesText, oracle.oracle_text);
  assert.equal(source.characteristics.manaCost, oracle.mana_cost);
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    read('../packages/cards/schema/card.schema.json'),
  );
  assert(validate(source), JSON.stringify(validate.errors));
  const d = pack.definitions.find((d) => d.name === source.name);
  const round = compileCard(
    sourceFromDefinition(d, { id: source.id, idsByName: { Wicked: token.id } }),
    { identities: { [token.id]: 'Wicked' } },
  );
  assert(round.ok, JSON.stringify(round.diagnostics));
  assert.deepEqual(round.definition, d);
});
test('Actual spell grants until end of turn; death returns tapped with Wicked on exactly the new incarnation', () => {
  let s = fixture();
  const c = put(s, 'Llanowar Elves'),
    spell = put(s, 'Not Dead After All', 0, 'hand'),
    old = ref(c);
  s = act(s, 'cast', { card: spell.id, target: old });
  s = resolve(s);
  assert.equal(roles(s).length, 0);
  assert.deepEqual(definition(s, s.objects[c.id]).triggers.at(-1).event, {
    event: 'battlefieldToGraveyard',
    object: 'source',
  });
  die(s, s.objects[c.id]);
  assert.equal(s.stack.length, 1);
  assert.deepEqual(s.stack[0].source, old);
  const grave = ref(s.objects[c.id]);
  assert.deepEqual(s.stack[0].departedSource, grave);
  resolveTop(s);
  assert.equal(s.objects[c.id].zone, 'battlefield');
  assert.equal(s.objects[c.id].tapped, true);
  assert.equal(roles(s).length, 1);
  assert.deepEqual(roles(s)[0].attachedTo, ref(s.objects[c.id]));
  assert.notEqual(s.objects[c.id].incarnation, grave.incarnation);
  assert.equal(definition(s, s.objects[c.id]).triggers, undefined);
});
test('A stolen creature returns to its owner, while its controller at death owns the trigger and Wicked token', () => {
  const s = fixture(),
    c = put(s, 'Llanowar Elves', 1);
  c.controller = 0;
  grant(s, c);
  die(s, c);
  assert.equal(s.stack[0].controller, 0);
  resolveTop(s);
  assert.equal(c.controller, 1);
  assert.equal(roles(s)[0].controller, 0);
  assert.equal(roles(s)[0].owner, 0);
  assert.equal(c.tapped, true);
});
test('Control changes before death change the granted trigger controller, rather than remembering the original spell caster', () => {
  const s = fixture(),
    c = put(s, 'Llanowar Elves');
  grant(s, c);
  c.controller = 1;
  die(s, c);
  assert.equal(s.stack[0].controller, 1);
  resolveTop(s);
  assert.equal(c.controller, 0);
  assert.equal(roles(s)[0].controller, 1);
});
test('Multiple grants trigger separately but only the first resolution can return the original graveyard incarnation', () => {
  let s = fixture();
  const c = put(s, 'Llanowar Elves');
  grant(s, c);
  grant(s, c);
  die(s, c);
  assert.equal(s.choice.kind, 'orderTriggers');
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  assert.equal(s.stack.length, 2);
  resolveTop(s);
  resolveTop(s);
  assert.equal(roles(s).length, 1);
  assert.equal(s.objects[c.id].zone, 'battlefield');
});
test('Exile replacement, a token death, and an intervening graveyard move cannot manufacture a returned creature or Wicked', () => {
  for (const scenario of ['token', 'exile', 'graveyard-move']) {
    const s = fixture(),
      c = put(s, scenario === 'token' ? 'Soldier Token' : 'Llanowar Elves');
    grant(s, c);
    if (scenario === 'exile') {
      put(s, 'Rest in Peace');
      die(s, c);
      assert.equal(c.zone, 'exile');
      assert.equal(s.stack.length, 0);
    } else {
      die(s, c);
      if (scenario === 'graveyard-move') {
        move(s, c, 'hand');
        move(s, c, 'graveyard');
      }
      resolveTop(s);
    }
    assert.equal(roles(s).length, 0);
    assert.notEqual(s.objects[c.id]?.zone, 'battlefield');
  }
});
test('Returning an animated noncreature card enters tapped but does not create an illegally attached Role', () => {
  const s = fixture(),
    land = put(s, 'Forest');
  addModifier(s, {
    objectId: land.id,
    incarnation: land.incarnation,
    addTypes: ['creature'],
    animation: { power: 2, toughness: 2, subtypes: [] },
    expires: s.turn,
  });
  grant(s, land);
  die(s, land);
  assert.equal(s.stack.length, 1);
  resolveTop(s);
  assert.equal(land.zone, 'battlefield');
  assert.equal(land.tapped, true);
  assert.equal(definition(s, land).type, 'land');
  assert.equal(roles(s).length, 0);
});
test('Entry-choice pauses keep death-return identity and token controller, then attach exactly once after resumption', () => {
  let s = fixture();
  const c = put(s, 'Returning Choice Creature', 1);
  c.controller = 0;
  grant(s, c);
  die(s, c);
  resolveTop(s);
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.choice.player, 1);
  assert.equal(roles(s).length, 0);
  assert.equal(s.objects[c.id].zone, 'graveyard');
  s = act(s, 'chooseCreatureType', { creatureType: 'Human' }, 1);
  assert.equal(s.objects[c.id].controller, 1);
  assert.equal(roles(s).length, 1);
  assert.equal(roles(s)[0].controller, 0);
  assert.deepEqual(roles(s)[0].attachedTo, ref(s.objects[c.id]));
  assert.equal(s.resolving, null);
});
test('Ability-removal timestamps, expiration, blink and copy values cannot retain an old grant', () => {
  for (const scenario of ['remove', 'expire', 'blink']) {
    const s = fixture(),
      c = put(s, 'Llanowar Elves');
    grant(s, c);
    assert.equal(copiableDefinition(s, c).triggers, undefined);
    if (scenario === 'remove')
      addModifier(s, {
        objectId: c.id,
        incarnation: c.incarnation,
        removeAbilities: true,
        expires: s.turn,
      });
    if (scenario === 'expire') finishCleanup(s);
    if (scenario === 'blink') {
      move(s, c, 'exile');
      enterBattlefield(s, c);
    }
    die(s, c);
    assert.equal(s.stack.length, 0);
    assert.equal(roles(s).length, 0);
  }
  const s = fixture(),
    c = put(s, 'Llanowar Elves');
  addModifier(s, {
    objectId: c.id,
    incarnation: c.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  grant(s, c);
  die(s, c);
  assert.equal(s.stack.length, 1);
  resolveTop(s);
  assert.equal(roles(s).length, 1);
});
test('Temporary death-return grants fail closed for incorrect duration, noncreature target and unresolved token references', () => {
  for (const mutate of [
    (s) => (s.abilities[0].effects[0].until = 'forever'),
    (s) => (s.abilities[0].effects[0].target = 'source'),
    (s) => (s.abilities[0].target = { scope: 'permanent', where: { type: 'land' } }),
    (s) => (s.abilities[0].effects[0].attachedToken = 'missing'),
  ]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.equal(compileCard(bad, { identities: { [token.id]: 'Wicked' } }).ok, false);
  }
  const badToken = structuredClone(token);
  badToken.abilities = [];
  assert.equal(compilePack([source, badToken]).ok, false);
});

test('This creature remains the granted source after a type-only change, so its own graveyard departure still returns it', () => {
  const s = fixture(),
    c = put(s, 'Llanowar Elves');
  grant(s, c);
  addModifier(s, {
    objectId: c.id,
    incarnation: c.incarnation,
    enchantmentOnly: true,
    permanent: true,
  });
  assert.equal(definition(s, c).type, 'enchantment');
  die(s, c);
  assert.equal(s.stack.length, 1);
  resolveTop(s);
  assert.equal(c.zone, 'battlefield');
  assert.equal(definition(s, c).type, 'creature');
  assert.equal(roles(s).length, 1);
});
