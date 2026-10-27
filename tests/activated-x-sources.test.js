import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import {
  dispatch,
  legalActions,
  ref,
  stats,
  hasKeyword,
  canBlock,
  definition,
  chooseBotCommand,
} from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import {
  enterBattlefieldBatch,
  stabilize,
  resolveEffects,
} from '../packages/engine/src/effects.js';
import { act, put, resolve } from '../packages/engine/test/helpers.js';
import {
  oracleIds,
  sources,
  definitions,
  mechanics,
  identities,
  idsByName,
  fixture,
} from './helpers/activated-x-catalog.js';
const alquist = 'Alquist Proft, Master Sleuth',
  mindspring = 'Mindspring Merfolk',
  stature = 'Stature, Size Shifter';
const expected = {
  [alquist]: {
    cost: { generic: 1, W: 1, U: 1 },
    power: 3,
    toughness: 3,
    legendary: true,
    subtypes: ['Human', 'Detective'],
    text: 'Vigilance\nWhen Alquist Proft enters, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\n{X}{W}{U}{U}, {T}, Sacrifice a Clue: You draw X cards and gain X life.',
  },
  [mindspring]: {
    cost: { U: 1 },
    power: 1,
    toughness: 1,
    subtypes: ['Merfolk', 'Wizard'],
    text: 'Exhaust — {X}{U}{U}, {T}: Draw X cards. Put a +1/+1 counter on each Merfolk creature you control. (Activate each exhaust ability only once.)',
  },
  [stature]: {
    cost: { U: 1 },
    power: 1,
    toughness: 1,
    legendary: true,
    subtypes: ['Human', 'Hero'],
    text: "Stature can't be blocked if her power is 1 or less.\nPower-up — {X}{U}{U}: Put X +1/+1 counters on Stature. (Activate each power-up ability only once. Reduce the cost by her mana cost if she entered this turn.)",
  },
};
test('three exact Standard activated-X sources preserve complete Oracle text, characteristics, identity and roundtrip', () => {
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url))),
  );
  for (const source of sources) {
    assert.equal(source.id, oracleIds[source.name]);
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    const d = definitions[source.name];
    for (const [key, value] of Object.entries(expected[source.name]))
      assert.deepEqual(d[key], value, `${source.name} ${key}`);
    const result = compileCard(sourceFromDefinition(d, { id: source.id, idsByName }), {
      mechanics,
      identities,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, d);
  }
  assert.equal(sources.length, 3);
});
test('Alquist investigates on entry, has vigilance, pays exact mana/tap/Clue and keeps both X effects after removal', () => {
  let s = fixture();
  const o = put(s, alquist, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  s = resolve(s);
  const clue = Object.values(s.objects).find(
    (o) => o.name === 'Clue Token' && o.zone === 'battlefield',
  );
  assert.ok(clue);
  assert.equal(definition(s, clue).activated[0].cost.sacrificeSelf, true);
  assert.equal(hasKeyword(s, s.objects[o.id], 'vigilance'), true);
  s.players[0].mana.W = 1;
  s.players[0].mana.U = 5;
  const command = {
    type: 'activate',
    player: 0,
    card: o.id,
    ability: 0,
    x: 3,
    sacrifices: [ref(clue)],
  };
  assert.equal(dispatch(s, command).ok, false, 'summoning sickness applies to tap');
  s.objects[o.id].controlledSince = s.turn - 1;
  const bad = put(s, 'Food Token');
  assert.equal(dispatch(s, { ...command, sacrifices: [ref(bad)] }).ok, false);
  assert.equal(dispatch(s, { ...command, sacrifices: [] }).ok, false);
  const result = dispatch(s, command);
  assert.equal(result.ok, true, result.error?.message);
  s = result.state;
  assert.equal(s.objects[o.id].tapped, true);
  assert.equal(s.objects[clue.id], undefined);
  assert.equal(s.players[0].mana.W + s.players[0].mana.U, 0);
  assert.equal(s.stack.at(-1).x, 3);
  const hand = s.players[0].hand.length;
  move(s, s.objects[o.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand + 3);
  assert.equal(s.players[0].life, 23);
});
test('Alquist zero still consumes Clue and tap without drawing or life gain; stale costs reject atomically', () => {
  let s = fixture();
  const o = put(s, alquist),
    clue = put(s, 'Clue Token');
  s.players[0].mana.W = 1;
  s.players[0].mana.U = 2;
  const stale = ref(clue);
  move(s, clue, 'exile');
  move(s, clue, 'battlefield');
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: o.id, ability: 0, x: 0, sacrifices: [stale] })
      .ok,
    false,
  );
  assert.deepEqual(s, before);
  const hand = s.players[0].hand.length;
  s = act(s, 'activate', { card: o.id, ability: 0, x: 0, sacrifices: [ref(clue)] });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.objects[o.id].tapped, true);
});
test('Mindspring zero exhaust still counters every controlled Merfolk creature, excludes other types/controllers', () => {
  let s = fixture();
  const o = put(s, mindspring),
    ally = put(s, 'Merfolk Coralsmith'),
    other = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Merfolk Coralsmith', 1);
  s.players[0].mana.U = 2;
  const hand = s.players[0].hand.length;
  s = act(s, 'activate', { card: o.id, ability: 0, x: 0 });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand);
  assert.equal(stats(s, s.objects[o.id]).power, 2);
  assert.equal(stats(s, s.objects[ally.id]).power, 3);
  assert.equal(stats(s, s.objects[other.id]).power, 2);
  assert.equal(stats(s, s.objects[enemy.id]).power, 2);
  s.objects[o.id].tapped = false;
  s.players[0].mana.U = 20;
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'activate' && a.card === o.id),
    false,
  );
  move(s, s.objects[o.id], 'hand');
  move(s, s.objects[o.id], 'battlefield');
  s.objects[o.id].controlledSince = s.turn - 1;
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'activate' && a.card === o.id),
    true,
  );
});
test('Mindspring draws locked X and buffs current allied Merfolk even when original source is gone', () => {
  let s = fixture();
  const o = put(s, mindspring),
    ally = put(s, 'Merfolk Coralsmith');
  s.players[0].mana.U = 5;
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3 });
  move(s, s.objects[o.id], 'graveyard');
  const hand = s.players[0].hand.length;
  const arrived = put(s, mindspring);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand + 3);
  assert.equal(stats(s, s.objects[ally.id]).power, 3);
  assert.equal(stats(s, s.objects[arrived.id]).power, 2);
});
test('Stature current-power evasion, entry-turn reduction and once-per-incarnation counters are complete', () => {
  let s = fixture();
  const o = put(s, stature),
    blocker = put(s, 'Grizzly Bears', 1);
  o.enteredTurn = s.turn;
  s.players[0].mana.U = 3;
  assert.equal(canBlock(s, blocker, o, 1), false);
  s = act(s, 'activate', { card: o.id, ability: 0, x: 2 });
  assert.deepEqual(s.stack.at(-1).activationCost.mana, { U: 1, generic: 2 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, 3);
  assert.equal(canBlock(s, s.objects[blocker.id], s.objects[o.id], 1), true);
  s.players[0].mana.U = 5;
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: o.id, ability: 0, x: 1 }).ok,
    false,
  );
  move(s, s.objects[o.id], 'hand');
  move(s, s.objects[o.id], 'battlefield');
  s.objects[o.id].enteredTurn = s.turn - 1;
  s = act(s, 'activate', { card: o.id, ability: 0, x: 2 });
  assert.deepEqual(s.stack.at(-1).activationCost.mana, { U: 2, generic: 2 });
  move(s, s.objects[o.id], 'hand');
  move(s, s.objects[o.id], 'battlefield');
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, 1);
});
test('Stature copied abilities retain variable mana but not used Power-up designation, subject to legend rule', () => {
  let s = fixture();
  const o = put(s, stature);
  o.enteredTurn = s.turn;
  s.players[0].mana.U = 2;
  s = act(s, 'activate', { card: o.id, ability: 0, x: 1 });
  s = resolve(s);
  resolveEffects(s, {
    controller: 0,
    target: ref(s.objects[o.id]),
    effects: [{ op: 'copyToken', count: 1, exceptions: { nonlegendary: true } }],
  });
  const copy = Object.values(s.objects).find(
    (o) => o.token && o.zone === 'battlefield' && o.name === stature,
  );
  assert.ok(copy);
  assert.equal(definition(s, copy).legendary, undefined);
  assert.equal(copy.powerUpUses?.[0], undefined);
  s.players[0].mana.U = 3;
  s = act(s, 'activate', { card: copy.id, ability: 0, x: 2 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[copy.id]).power, 3);
});
test('real-source bots select positive payable X and complete selected Clue payment', () => {
  for (const name of [alquist, mindspring, stature]) {
    const s = fixture(),
      o = put(s, name);
    o.enteredTurn = s.turn - 1;
    s.players[0].mana.U = 5;
    s.players[0].mana.W = 1;
    if (name === alquist) put(s, 'Clue Token');
    const command = chooseBotCommand(s, 0);
    assert.equal(command.type, 'activate', name);
    assert.equal(command.card, o.id);
    assert.ok(command.x > 0, name);
    if (name === alquist) assert.equal(command.sacrifices.length, 1);
    assert.equal(dispatch(s, command).ok, true, name);
  }
});
