import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  legalActions,
  ref,
  definition,
} from '../packages/engine/src/index.js';
import { addObject, move } from '../packages/engine/src/model.js';
import { enterBattlefield } from '../packages/engine/src/effects.js';
import { compilePack } from '../packages/cards/pack.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { act, resolve, lands } from '../packages/engine/test/helpers.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const source = read('../packages/cards/cards/return-triumphant.json');
const oracle = read('./fixtures/return-triumphant-oracle-reviewed.json').cards[0];
const token = read('../packages/cards/cards/young-hero-role.json');
const pack = compilePack([source, token]);
assert(pack.ok, JSON.stringify(pack.diagnostics));
const chooser = {
  ...CARDS['Llanowar Elves'],
  name: 'Entry-choice Creature',
  cost: { generic: 3 },
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
  lands(s, 'Plains', 2);
  return s;
}
const put = (s, name, player = 0, zone = 'graveyard') => addObject(s, name, player, zone);
const roles = (s) =>
  Object.values(s.objects).filter((o) => o.name === 'Young Hero' && o.zone === 'battlefield');

test('Return Triumphant compiles every verified Oracle clause and round-trips its compound returned-object contract', () => {
  assert.equal(source.id, oracle.oracle_id);
  assert.equal(source.rulesText, oracle.oracle_text);
  assert.equal(source.characteristics.manaCost, oracle.mana_cost);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    read('../packages/cards/schema/card.schema.json'),
  );
  assert(validate(source), JSON.stringify(validate.errors));
  const d = pack.definitions.find((d) => d.name === source.name);
  const native = sourceFromDefinition(d, { id: source.id, idsByName: { 'Young Hero': token.id } });
  const compiled = compileCard(native, { identities: { [token.id]: 'Young Hero' } });
  assert(compiled.ok, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.definition, d);
});
test('Return Triumphant returns the exact graveyard incarnation then attaches one Hero to its new incarnation', () => {
  let s = fixture();
  const c = put(s, 'Llanowar Elves'),
    spell = put(s, 'Return Triumphant', 0, 'hand'),
    old = ref(c);
  s = act(s, 'cast', { card: spell.id, target: old });
  s = resolve(s);
  assert.equal(s.objects[c.id].zone, 'battlefield');
  assert.notEqual(s.objects[c.id].incarnation, old.incarnation);
  assert.equal(roles(s).length, 1);
  assert.deepEqual(roles(s)[0].attachedTo, ref(s.objects[c.id]));
  assert.equal(s.objects[c.id].tapped, false);
  assert.equal(definition(s, s.objects[c.id]).triggers[0].event, 'selfAttacks');
});
test('Return target selection rejects opponent graveyards and mana value four, without mutating the input', () => {
  const s = fixture(),
    foreign = put(s, 'Llanowar Elves', 1),
    large = put(s, 'Serra Angel'),
    spell = put(s, 'Return Triumphant', 0, 'hand');
  const before = structuredClone(s);
  for (const c of [foreign, large])
    assert.equal(
      dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(c) }).ok,
      false,
    );
  assert.deepEqual(s, before);
});
test('Exiling or returning the target before resolution does not create or attach a Role to a later incarnation', () => {
  for (const returned of [false, true]) {
    let s = fixture();
    const c = put(s, 'Llanowar Elves'),
      spell = put(s, 'Return Triumphant', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, target: ref(c) });
    move(s, s.objects[c.id], 'exile');
    if (returned) enterBattlefield(s, s.objects[c.id]);
    s = resolve(s);
    assert.equal(roles(s).length, 0);
    assert.equal(s.objects[c.id].zone, returned ? 'battlefield' : 'exile');
  }
});
test('Paused entry choices persist the return continuation; no Role exists before entry, and resumption creates it exactly once', () => {
  let s = fixture();
  const c = put(s, 'Entry-choice Creature'),
    spell = put(s, 'Return Triumphant', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(c) });
  s = resolve(s);
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.objects[c.id].zone, 'graveyard');
  assert.equal(roles(s).length, 0);
  assert.equal(s.resolving.entry.name, 'Return Triumphant');
  const pause = structuredClone(s);
  const command = { type: 'chooseCreatureType', player: 0, creatureType: 'Human' };
  const result = dispatch(s, command);
  assert(result.ok, result.error?.message);
  s = result.state;
  assert.equal(s.objects[c.id].chosenCreatureType, 'Human');
  assert.equal(roles(s).length, 1);
  assert.deepEqual(roles(s)[0].attachedTo, ref(s.objects[c.id]));
  assert.equal(s.resolving, null);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
  assert.deepEqual(dispatch(pause, command).state, s);
  const before = structuredClone(s);
  assert.equal(dispatch(s, command).ok, false);
  assert.deepEqual(s, before);
});
test('Returning with a token rejects broad battlefield targets, grouped returns, unknown/non-Aura tokens and hand destinations', () => {
  const identities = { [token.id]: token.name };
  for (const mutate of [
    (s) => (s.abilities[0].effects[0].destination = 'hand'),
    (s) => (s.abilities[0].target.scope = 'permanent'),
    (s) => (s.abilities[0].effects[0].attachedToken = 'missing'),
    (s) => {
      const a = s.abilities[0];
      a.targetGroups = [{ id: 'returned', selector: a.target, min: 1, max: 1 }];
      delete a.target;
      a.effects[0].targetGroup = 'returned';
    },
  ]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.equal(compileCard(bad, { identities }).ok, false);
  }
  const badToken = structuredClone(token);
  badToken.abilities = [];
  assert.equal(compilePack([source, badToken]).ok, false);
});
