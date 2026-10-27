import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, ref, validateEventSpec } from '../src/index.js';
import { sacrificePermanents, move, notifyTriggers, definition } from '../src/model.js';
import { stabilize, resolveEffects } from '../src/effects.js';
import { tapForMana } from '../src/mana.js';
import { payCost } from '../src/costs.js';
import { fixture, put, act, resolve, lands } from './helpers.js';

function settle(s) {
  stabilize(s);
  for (let i = 0; i < 50 && (s.choice || s.stack.length); i++) {
    if (s.choice?.kind === 'orderTriggers')
      s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
    else if (s.choice?.kind === 'triggerTarget')
      s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 - s.choice.player } });
    else if (s.choice) throw new Error(`Unhandled ${s.choice.kind}`);
    else s = resolve(s);
  }
  return s;
}

test('sacrifice is distinct from destruction and state-based death', () => {
  const s = fixture();
  put(s, 'Crime Novelist');
  const artifact = put(s, 'Ornithopter');
  move(s, artifact, 'graveyard');
  assert.equal(s.pendingTriggers.length, 0);
  const zero = put(s, 'Ornithopter');
  zero.plusCounters = -2;
  stabilize(s);
  assert.equal(s.stack.length, 0);
  assert.equal(
    s.events.some((e) => e.type === 'sacrificed'),
    false,
  );
});

test('mana, activated, casting and resolving sacrifices use the same event family', () => {
  for (const route of ['mana', 'activated', 'cast', 'effect']) {
    let s = fixture();
    const watcher = put(s, 'Crime Novelist');
    if (route === 'mana') tapForMana(s, put(s, 'Treasure Token').id, 0, 'R');
    if (route === 'activated')
      payCost(s, 0, { sacrificeSelf: true }, { sourceId: put(s, 'Clue Token').id });
    if (route === 'effect') {
      const artifact = put(s, 'Clue Token');
      resolveEffects(s, {
        id: 's-custom',
        kind: 'ability',
        controller: 0,
        source: ref(artifact),
        effects: [{ op: 'sacrificeSelf' }],
      });
    }
    if (route === 'cast') {
      const victim = put(s, 'Ornithopter');
      const spell = put(s, 'Corrupted Conviction', 0, 'hand');
      lands(s, 'Swamp', 1);
      s = act(s, 'cast', { card: spell.id, sacrifice: ref(victim) });
    }
    s = settle(s);
    assert.equal(s.objects[watcher.id].plusCounters, 1, route);
    assert.equal(s.players[0].mana.R, route === 'mana' ? 2 : 1, route);
    assert.equal(s.events.filter((e) => e.type === 'sacrificed').length, 1, route);
  }
});

test('simultaneous sacrifices retain departing observers and pre-departure artifact types', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Watcher: {
      name: 'Watcher',
      type: 'artifact',
      cost: {},
      triggers: [
        {
          event: { event: 'sacrifice', controller: 'you', filter: { type: 'artifact' } },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    },
  });
  const watcher = put(s, 'Watcher'),
    other = put(s, 'Clue Token');
  sacrificePermanents(s, [watcher, other]);
  assert.equal(s.pendingTriggers.length, 2);
  assert.ok(s.pendingTriggers.every((e) => e.source.incarnation === 0));
  s = settle(s);
  assert.equal(s.players[0].life, 22);
});

test('self sacrifice, other-object exclusion, controller relation and token filters are independent', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Self: {
      name: 'Self',
      type: 'artifact',
      cost: {},
      triggers: [
        {
          event: { event: 'sacrifice', object: 'source' },
          effects: [{ op: 'gainLife', amount: 3 }],
        },
      ],
    },
  });
  const self = put(s, 'Self'),
    enemy = put(s, 'Clue Token', 1),
    pirate = put(s, 'Pirate Peddlers'),
    light = put(s, 'Lightless Evangel');
  sacrificePermanents(s, [enemy]);
  assert.equal(s.pendingTriggers.length, 0);
  sacrificePermanents(s, [put(s, 'Forest'), self]);
  s = settle(s);
  assert.equal(s.objects[pirate.id].plusCounters, 2);
  assert.equal(s.objects[light.id].plusCounters, 1);
  assert.equal(s.players[0].life, 23);
  sacrificePermanents(s, [s.objects[pirate.id]]);
  assert.equal(s.pendingTriggers.filter((e) => e.source.id === pirate.id).length, 0);
});

test('once-per-turn is consumed once across a simultaneous batch and resets next turn', () => {
  let s = fixture();
  const tolls = put(s, 'Tolls of War');
  sacrificePermanents(s, [put(s, 'Clue Token'), put(s, 'Forest')]);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Ally Token' && o.zone === 'battlefield')
      .length,
    1,
  );
  sacrificePermanents(s, [put(s, 'Forest')]);
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  s.active = 1;
  sacrificePermanents(s, [put(s, 'Forest')]);
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  s.active = 0;
  sacrificePermanents(s, [put(s, 'Forest')]);
  assert.equal(s.pendingTriggers.length, 1);
  assert.ok(s.objects[tolls.id].triggerUses);
});

test('Food sacrifice creates exactly one nonblocking Rat; Clue sacrifice grows Geardrake', () => {
  let s = fixture();
  put(s, 'Experimental Confectioner');
  const drake = put(s, 'Gleaming Geardrake');
  sacrificePermanents(s, [put(s, 'Food Token'), put(s, 'Clue Token')]);
  s = settle(s);
  const rats = Object.values(s.objects).filter(
    (o) => o.name === 'Nonblocking Rat Token' && o.zone === 'battlefield',
  );
  assert.equal(rats.length, 1);
  assert.equal(definition(s, rats[0]).cannotBlock, true);
  assert.equal(s.objects[drake.id].plusCounters, 2);
});

test('opposing sacrifices deal damage to the actual sacrificing opponent, not the owner', () => {
  let s = fixture();
  put(s, 'Vengeful Tracker');
  const art = put(s, 'Clue Token', 0);
  art.controller = 1;
  sacrificePermanents(s, [art]);
  s = settle(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].life, 20);
});

test('Biotech retains targeted damage and Lander retains its actual basic-land search ability', () => {
  const d = CARDS['Biotech Specialist'];
  assert.equal(d.triggers.length, 1);
  assert.equal(d.etb[0].definition, 'Lander Token');
  assert.equal(d.triggers[0].target, 'opponent');
  const lander = CARDS['Lander Token'];
  assert.equal(lander.subtypes.includes('Lander'), true);
  assert.deepEqual(lander.activated[0].cost, {
    mana: { generic: 2 },
    tap: true,
    sacrificeSelf: true,
  });
  assert.equal(lander.activated[0].effects[0].op, 'searchLibrary');
  assert.deepEqual(lander.activated[0].effects[0].where, {
    all: [{ type: 'land' }, { basic: true }],
  });
});

test('sacrifice predicates fail closed for unsupported turn ordinals and targeting fields', () => {
  assert.deepEqual(
    validateEventSpec({ event: 'sacrifice', filter: { token: true }, excludeSource: true }),
    [],
  );
  for (const fields of [{ firstEachTurn: true }, { spellNumber: 1 }, { targetingKind: 'spell' }])
    assert.ok(validateEventSpec({ event: 'sacrifice', ...fields }).length);
});

test('Biotech enters with a functional Lander, whose sacrifice targets before its search resolves', () => {
  let s = fixture();
  s.players[0].mana = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };
  const specialist = put(s, 'Biotech Specialist', 0, 'hand');
  s = resolve(act(s, 'cast', { card: specialist.id }));
  s = resolve(s);
  const lander = Object.values(s.objects).find(
    (o) => o.name === 'Lander Token' && o.zone === 'battlefield',
  );
  assert.ok(lander);
  s = act(s, 'activate', { card: lander.id, ability: 0 });
  assert.equal(s.objects[lander.id], undefined);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  const basic = s.choice.cards[0];
  assert.ok(basic);
  s = act(s, 'searchLibrary', { cards: [basic] });
  assert.equal(s.objects[basic].zone, 'battlefield');
  assert.equal(s.objects[basic].tapped, true);
});

test('a failed casting-sacrifice command is atomic and does not consume watcher limits', () => {
  const s = fixture();
  put(s, 'Tolls of War');
  const spell = put(s, 'Corrupted Conviction', 0, 'hand'),
    enemy = put(s, 'Grizzly Bears', 1);
  lands(s, 'Swamp', 1);
  const before = structuredClone(s);
  const result = dispatch(s, { type: 'cast', player: 0, card: spell.id, sacrifice: ref(enemy) });
  assert.equal(result.ok, false);
  assert.deepEqual(s, before);
});

test('blinked objects cannot reuse old sacrifice-source counters and only actual new sacrifice triggers', () => {
  let s = fixture();
  const watcher = put(s, 'Crime Novelist');
  sacrificePermanents(s, [put(s, 'Clue Token')]);
  move(s, watcher, 'exile');
  move(s, watcher, 'battlefield');
  s = settle(s);
  assert.equal(s.objects[watcher.id].plusCounters, 0);
  assert.equal(s.players[0].mana.R, 1);
});
