import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  createRegistry,
  dispatch,
  targetsFor,
  stats,
  hasKeyword,
  ref,
  canTapForMana,
  assertInvariants,
} from '../packages/engine/src/index.js';
import { emptyMana } from '../packages/engine/src/model.js';
import { fixture, put, act } from '../packages/engine/test/helpers.js';
const review = JSON.parse(
  await readFile(new URL('./fixtures/standard-reviewed-v09.json', import.meta.url), 'utf8'),
);
const targetName = 'Execution target fixture',
  blankName = 'Execution spell fixture';
const catalog = createRegistry({
  ...CARDS,
  [targetName]: {
    name: targetName,
    type: 'creature',
    cost: {},
    power: 2,
    toughness: 30,
    keywords: ['flash'],
  },
  [blankName]: { name: blankName, type: 'instant', cost: {}, effects: [] },
});
function pool(cost = {}) {
  const mana = emptyMana();
  for (const [color, amount] of Object.entries(cost))
    mana[color === 'generic' ? 'C' : color] += amount;
  return mana;
}
function setup(name) {
  const state = fixture();
  state.catalog = catalog;
  const own = put(state, targetName, 0),
    enemy = put(state, targetName, 1);
  put(state, 'Island', 0, 'hand');
  put(state, 'Island', 0, 'hand');
  const source = put(state, name, 0, 'hand');
  return { state, own: own.id, enemy: enemy.id, source: source.id };
}
function chooseTarget(state, selector, effects, ids) {
  if (!selector) return undefined;
  const targets = targetsFor(state, selector, 0);
  const harmful = effects.some((e) =>
    ['damage', 'destroy', 'bounce', 'mill', 'counter'].includes(e.op),
  );
  return (
    targets.find((target) => target.kind === 'player' && target.id === 1) ??
    targets.find(
      (target) => target.kind === 'object' && target.id === (harmful ? ids.enemy : ids.own),
    ) ??
    targets[0]
  );
}
function snapshot(state, ids) {
  return {
    life: state.players.map((p) => p.life),
    hand: state.players.map((p) => p.hand.length),
    library: state.players.map((p) => p.library.length),
    graveyard: state.players.map((p) => p.graveyard.length),
    objects: Object.fromEntries(
      [ids.source, ids.own, ids.enemy].map((id) => [
        id,
        {
          ...stats(state, state.objects[id]),
          zone: state.objects[id].zone,
          damage: state.objects[id].damage,
          counters: state.objects[id].plusCounters,
          tapped: state.objects[id].tapped,
        },
      ]),
    ),
  };
}
function settle(state, ids) {
  const choices = [];
  for (let decisions = 0; decisions < 60 && (state.choice || state.stack.length); decisions++) {
    const c = state.choice;
    if (!c) state = act(state, 'pass');
    else if (c.kind === 'triggerTarget') {
      const target = chooseTarget(state, c.entry.targetKind, c.entry.effects, ids);
      choices.push({ kind: c.kind, target });
      state = act(state, 'chooseTriggerTarget', { target });
    } else if (c.kind === 'libraryOrder') {
      choices.push({ kind: c.action, count: c.cards.length });
      state = act(state, 'orderLibrary', { top: [], rest: [...c.cards] });
    } else if (c.kind === 'discardEffect') {
      choices.push({ kind: 'discard', count: c.count });
      state = act(state, 'discardEffect', {
        cards: state.players[c.player].hand.slice(0, c.count),
      });
    } else if (c.kind === 'orderTriggers')
      state = act(state, 'orderTriggers', { ids: c.entries.map((e) => e.id) });
    else throw new Error(`Unexpected choice in Standard fixture: ${c.kind}`);
  }
  assert.equal(state.choice, null);
  assert.equal(state.stack.length, 0);
  assert.equal(assertInvariants(state), true);
  return { state, choices };
}
/** A fixture oracle for the reviewed straight-line operations, separate from resolution code. */
function expectEffects(state, before, effects, target, ids, choices) {
  const life = [0, 0],
    hand = [0, 0],
    library = [0, 0];
  const changes = new Map();
  for (const effect of effects) {
    const subject = effect.subject === 'source' ? { kind: 'object', id: ids.source } : target;
    const change =
      subject?.kind === 'object'
        ? (changes.get(subject.id) ?? {
            power: 0,
            toughness: 0,
            damage: 0,
            counters: 0,
            keywords: [],
          })
        : null;
    if (change) changes.set(subject.id, change);
    switch (effect.op) {
      case 'draw':
        hand[0] += effect.count;
        library[0] -= effect.count;
        break;
      case 'discard':
        hand[0] -= effect.count;
        assert.ok(choices.some((c) => c.kind === 'discard' && c.count === effect.count));
        break;
      case 'scry':
        assert.ok(choices.some((c) => c.kind === 'scry' && c.count === effect.count));
        break;
      case 'surveil':
        library[0] -= effect.count;
        assert.ok(choices.some((c) => c.kind === 'surveil' && c.count === effect.count));
        break;
      case 'gainLife':
        life[0] += effect.amount;
        break;
      case 'damageOpponent':
        life[1] -= effect.amount;
        break;
      case 'damage':
        if (target.kind === 'player') life[target.id] -= effect.amount;
        else change.damage += effect.amount;
        break;
      case 'mill':
        library[effect.player === 'target' ? target.id : effect.player === 'opponent' ? 1 : 0] -=
          effect.count;
        break;
      case 'modify':
        change.power += effect.power;
        change.toughness += effect.toughness;
        change.keywords.push(...(effect.keywords ?? []));
        break;
      case 'counterOn':
        change.counters += effect.amount;
        change.power += effect.amount;
        change.toughness += effect.amount;
        break;
      case 'untap':
        change.tapped = false;
        break;
      case 'destroy':
        change.zone = 'graveyard';
        break;
      case 'bounce':
        change.zone = 'hand';
        hand[state.objects[target.id].owner]++;
        break;
      case 'counter':
        assert.equal(state.objects[ids.counterSource].zone, 'graveyard');
        break;
      default:
        throw new Error(`Unreviewed fixture opcode: ${effect.op}`);
    }
  }
  for (const player of [0, 1]) {
    assert.equal(state.players[player].life, before.life[player] + life[player], 'life delta');
    assert.equal(
      state.players[player].hand.length,
      before.hand[player] + hand[player],
      'hand delta',
    );
    assert.equal(
      state.players[player].library.length,
      before.library[player] + library[player],
      'library delta',
    );
  }
  for (const [id, change] of changes) {
    const object = state.objects[id],
      previous = before.objects[id];
    assert.equal(object.zone, change.zone ?? previous.zone, 'target zone');
    if (object.zone === 'battlefield') {
      assert.equal(stats(state, object).power, previous.power + change.power, 'power');
      assert.equal(
        stats(state, object).toughness,
        previous.toughness + change.toughness,
        'toughness',
      );
      assert.equal(object.damage, previous.damage + change.damage, 'marked damage');
      assert.equal(object.plusCounters, previous.counters + change.counters, 'counters');
      if (change.tapped !== undefined) assert.equal(object.tapped, change.tapped);
      for (const keyword of change.keywords)
        assert.equal(hasKeyword(state, object, keyword), true, keyword);
    }
  }
}
function castCase(definition) {
  const ids = setup(definition.name);
  let state = ids.state;
  if (definition.effects?.some((e) => e.op === 'counter')) {
    const spell = put(state, targetName, 1, 'hand');
    state.priority = 1;
    state = act(state, 'cast', { card: spell.id });
    state = act(state, 'pass');
    ids.counterSource = spell.id;
  }
  const target = chooseTarget(state, definition.target, definition.effects ?? [], ids);
  state.players[0].mana = pool(definition.cost);
  state = act(state, definition.type === 'land' ? 'playLand' : 'cast', {
    card: ids.source,
    ...(target ? { target } : {}),
    autoTap: false,
  });
  assert.equal(
    Object.values(state.players[0].mana).reduce((a, b) => a + b, 0),
    0,
    'exact casting payment',
  );
  const before = snapshot(state, ids),
    result = settle(state, ids);
  state = result.state;
  const enter = (definition.triggers ?? []).filter((t) => t.event === 'selfEnters');
  const effects = definition.effects ?? enter.flatMap((t) => t.effects);
  const resolvedTarget = target ?? result.choices.find((c) => c.kind === 'triggerTarget')?.target;
  expectEffects(state, before, effects, resolvedTarget, ids, result.choices);
  assert.equal(
    state.objects[ids.source].zone,
    ['instant', 'sorcery'].includes(definition.type) ? 'graveyard' : 'battlefield',
  );
  if (!['instant', 'sorcery'].includes(definition.type)) {
    assert.equal(state.objects[ids.source].tapped, !!definition.entersTapped);
    for (const keyword of definition.keywords)
      assert.equal(hasKeyword(state, state.objects[ids.source], keyword), true);
  }
  return { ...ids, state };
}
for (const { definition: d, oracle } of review.cards) {
  test(`${d.name}: reviewed casting, payment and resolution contract`, () => {
    const actual = CARDS[d.name];
    assert.ok(actual, 'card must be in the shipped catalog');
    assert.equal(CARD_IDS[oracle.id], d.name);
    assert.equal(actual.text, oracle.text);
    assert.deepEqual(actual.cost, d.cost);
    assert.deepEqual([...actual.types].sort(), [...d.types].sort());
    assert.deepEqual([...actual.subtypes].sort(), [...d.subtypes].sort());
    assert.deepEqual([...actual.color].sort(), [...oracle.colors].sort());
    if (d.type === 'creature') {
      assert.equal(actual.power, Number(oracle.power));
      assert.equal(actual.toughness, Number(oracle.toughness));
    }
    castCase(d);
  });
  if (d.mana)
    test(`${d.name}: each printed mana option adds exactly one mana`, () => {
      const ids = castCase(d),
        base = ids.state,
        colors = Array.isArray(d.mana) ? d.mana : [d.mana];
      if (d.type === 'creature' && !d.keywords.includes('haste'))
        assert.equal(canTapForMana(base, base.objects[ids.source], 0), false);
      for (const color of colors) {
        let state = structuredClone(base);
        state.objects[ids.source].tapped = false;
        state.objects[ids.source].controlledSince = state.turn - 1;
        state = act(state, 'tapMana', { card: ids.source, color });
        assert.equal(state.players[0].mana[color], 1);
        assert.equal(
          Object.values(state.players[0].mana).reduce((a, b) => a + b, 0),
          1,
        );
        assert.equal(state.objects[ids.source].tapped, true);
        assert.equal(state.stack.length, 0);
      }
    });
  for (const [index, ability] of (d.activated ?? []).entries())
    test(`${d.name}: activated ability ${index + 1} pays costs and executes`, () => {
      const ids = castCase(d);
      let state = ids.state;
      state.objects[ids.source].tapped = false;
      state.objects[ids.source].controlledSince = state.turn - 1;
      state.players[0].mana = pool(ability.cost.mana);
      const target = chooseTarget(state, ability.target, ability.effects, ids);
      state = act(state, 'activate', {
        card: ids.source,
        ability: index,
        ...(target ? { target } : {}),
      });
      assert.equal(
        Object.values(state.players[0].mana).reduce((a, b) => a + b, 0),
        0,
      );
      assert.equal(state.objects[ids.source].tapped, !!ability.cost.tap);
      const before = snapshot(state, ids),
        result = settle(state, ids);
      expectEffects(result.state, before, ability.effects, target, ids, result.choices);
    });
  for (const trigger of (d.triggers ?? []).filter((t) => t.event !== 'selfEnters'))
    test(`${d.name}: ${trigger.event} executes the reviewed trigger`, () => {
      const ids = castCase(d);
      let state = ids.state;
      if (trigger.effects.some((e) => e.op === 'untap')) state.objects[ids.source].tapped = true;
      const eventCard = put(
        state,
        trigger.event === 'controllerLandEnters' ? 'Forest' : blankName,
        0,
        'hand',
      );
      state = act(state, trigger.event === 'controllerLandEnters' ? 'playLand' : 'cast', {
        card: eventCard.id,
      });
      const before = snapshot(state, ids),
        result = settle(state, ids);
      expectEffects(result.state, before, trigger.effects, undefined, ids, result.choices);
    });
}
