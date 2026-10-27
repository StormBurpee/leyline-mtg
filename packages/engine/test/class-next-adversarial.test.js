import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CARDS,
  CARD_IDS,
  createRegistry,
  createGame,
  exportReplay,
  replay,
  dispatch,
  playerView,
  chooseBotCommand,
  definition,
  stats,
} from '../src/index.js';
import { ref, move, addModifier } from '../src/model.js';
import { resolveEffects, continueResolution, dealDamageBatch, stabilize } from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';
import { fixture, put, act, resolve } from './helpers.js';

const source = JSON.parse(
  fs.readFileSync(new URL('../../cards/cards/gossip-s-talent.json', import.meta.url)),
);
const compiled = compileCard(source, { identities: { ...CARD_IDS, [source.id]: source.name } });
assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
const catalog = createRegistry({ ...CARDS, [source.name]: compiled.definition });
function setup() {
  const s = fixture();
  s.catalog = catalog;
  return s;
}
function effect(s, effects, extra = {}) {
  return resolveEffects(s, {
    kind: 'ability',
    name: 'review probe',
    source: null,
    sourceKeywords: [],
    controller: 0,
    effects,
    ...extra,
  });
}
function exile(s, source, victim) {
  effect(s, [{ op: 'exileUntilSourceLeaves' }], { source: ref(source), target: ref(victim) });
}

// CR 610.3 (2026-09-25): the linked return happens immediately after departure,
// before the next part of the resolving blink. The two returns are not a batch.
test('Gossip blink returns Werefox Bodyguard exile before Bodyguard, so Soul Warden sees it enter', () => {
  let s = setup();
  const talent = put(s, "Gossip's Talent");
  talent.classLevel = 3;
  const bodyguard = put(s, 'Werefox Bodyguard'),
    warden = put(s, 'Soul Warden', 1);
  exile(s, bodyguard, warden);
  dealDamageBatch(
    s,
    [
      {
        source: {
          ...ref(bodyguard),
          controller: 0,
          definition: definition(s, bodyguard),
          keywords: [],
        },
        target: { kind: 'player', id: 1 },
        amount: 2,
      },
    ],
    true,
  );
  stabilize(s);
  s = resolve(s);
  s = act(s, 'resolveOptional', { accept: true });
  const returns = s.events.filter(
    (e) =>
      e.type === 'zoneChange' &&
      e.to === 'battlefield' &&
      [bodyguard.id, warden.id].includes(e.objectId),
  );
  assert.deepEqual(
    returns.map((e) => e.objectId),
    [warden.id, bodyguard.id],
  );
  assert.equal(
    s.events.filter((e) => e.type === 'triggered' && e.name === 'Soul Warden').length,
    1,
  );
});

test('linked Aura with no legal attachment remains exiled before blinked creature returns', () => {
  const s = setup(),
    creature = put(s, 'Grizzly Bears'),
    aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(creature);
  exile(s, creature, aura);
  effect(s, [{ op: 'blink' }], { target: ref(creature) });
  assert.equal(s.choice, null);
  assert.equal(aura.zone, 'exile');
  assert.equal(creature.zone, 'battlefield');
});

test('linked entry choice precedes blinked entry choice and preserves grouped parent continuation', () => {
  for (const grouped of [false, true]) {
    let s = setup();
    const fountain = put(s, 'Hallowed Fountain', 1),
      cavern = put(s, 'Cavern of Souls');
    exile(s, fountain, cavern);
    const entry = {
      kind: 'ability',
      name: 'review probe',
      source: null,
      controller: 0,
      effects: [
        { op: 'blink', ...(grouped ? { targetGroup: 'one' } : {}) },
        { op: 'gainLife', amount: 4 },
      ],
      ...(grouped
        ? {
            targetGroups: [{ id: 'one', selector: 'permanent', min: 1, max: 1 }],
            targets: { one: [ref(fountain)] },
          }
        : { target: ref(fountain) }),
    };
    s.resolving = { entry, index: 0 };
    continueResolution(s);
    assert.equal(s.choice.kind, 'creatureType');
    assert.equal(s.choice.card, cavern.id);
    assert.equal(fountain.zone, 'exile');
    assert.equal(s.players[0].life, 20);
    assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
    s = act(s, 'chooseCreatureType', { creatureType: 'Robot' });
    assert.equal(s.choice.kind, 'entryLife');
    assert.equal(s.choice.player, 1);
    assert.equal(s.objects[cavern.id].zone, 'battlefield');
    assert.equal(s.objects[fountain.id].zone, 'exile');
    assert.equal(s.players[0].life, 20);
    const command = chooseBotCommand(playerView(s, 1), 1);
    assert.equal(command.type, 'payEntryLife');
    const result = dispatch(s, command);
    assert.ok(result.ok);
    s = result.state;
    assert.equal(s.objects[fountain.id].zone, 'battlefield');
    assert.equal(s.objects[fountain.id].controller, 1);
    assert.equal(s.players[0].life, 24);
    assert.equal(s.resolving, null);
    assert.equal(
      s.events.filter(
        (e) => e.type === 'zoneChange' && e.objectId === fountain.id && e.to === 'exile',
      ).length,
      1,
    );
  }
});

test('pending blink return never follows an unrelated incarnation across linked-entry continuation', () => {
  let s = setup();
  const creature = put(s, 'Grizzly Bears'),
    cavern = put(s, 'Cavern of Souls');
  exile(s, creature, cavern);
  effect(s, [{ op: 'blink' }, { op: 'gainLife', amount: 2 }], { target: ref(creature) });
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(creature.zone, 'exile');
  move(s, creature, 'hand');
  move(s, creature, 'exile');
  s = act(s, 'chooseCreatureType', { creatureType: 'Robot' });
  assert.equal(s.objects[creature.id].zone, 'exile');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.resolving, null);
});

test('token blink still returns linked exiles but never schedules its own return', () => {
  const s = setup(),
    token = put(s, 'Soldier Token'),
    warden = put(s, 'Soul Warden', 1);
  exile(s, token, warden);
  effect(s, [{ op: 'blink' }, { op: 'gainLife', amount: 2 }], { target: ref(token) });
  assert.equal(token.zone, 'exile');
  assert.equal(warden.zone, 'battlefield');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.pendingTriggers.length, 0);
});

test('permanent animation uses later base setters without copying type or counters into token copies', () => {
  const s = setup(),
    token = put(s, 'Treasure Token');
  token.plusCounters = 3;
  effect(s, [{ op: 'animatePermanent', power: 0, toughness: 0, subtypes: ['Robot'] }], {
    target: ref(token),
  });
  addModifier(s, {
    objectId: token.id,
    incarnation: token.incarnation,
    removeAbilities: true,
    permanent: true,
  });
  assert.deepEqual(stats(s, token), { power: 3, toughness: 3 });
  effect(s, [{ op: 'creatureForm', power: 4, toughness: 5, subtypes: ['Frog'] }], {
    target: ref(token),
  });
  assert.deepEqual(stats(s, token), { power: 7, toughness: 8 });
  assert.ok(definition(s, token).types.includes('artifact'));
  assert.ok(definition(s, token).subtypes.includes('Treasure'));
  assert.ok(!definition(s, token).subtypes.includes('Robot'));
  effect(s, [{ op: 'copyToken', count: 1 }], { target: ref(token) });
  const copy = Object.values(s.objects).find((o) => o.id !== token.id && o.name === token.name);
  assert.equal(definition(s, copy).type, 'artifact');
  assert.equal(copy.plusCounters, 0);
  assert.ok(!definition(s, copy).subtypes.includes('Robot'));
});

test('linked-then-blink entry choices replay deterministically at both paused stages', () => {
  const blinking = {
    name: 'Replay blinking land',
    type: 'land',
    cost: {},
    chooseCreatureType: true,
    activated: [
      { cost: {}, target: 'permanent', effects: [{ op: 'exileUntilSourceLeaves' }] },
      {
        cost: {},
        effects: [
          { op: 'blink', subject: 'source' },
          { op: 'gainLife', amount: 1 },
        ],
      },
    ],
  };
  const linked = {
    name: 'Replay linked land',
    type: 'land',
    cost: {},
    chooseCreatureType: true,
  };
  const catalog = createRegistry({ ...CARDS, [blinking.name]: blinking, [linked.name]: linked });
  let s = createGame({
    catalog,
    mulligan: false,
    minimumDeckSize: 0,
    seed: 3,
    decks: [
      [...Array(4).fill(blinking.name), ...Array(4).fill(linked.name), ...Array(4).fill('Forest')],
      Array(12).fill('Island'),
    ],
  });
  while (s.step !== 'main1') s = resolve(s);
  const source = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === blinking.name),
    victim = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === linked.name);
  assert.ok(source && victim);
  for (const [index, card] of [source, victim].entries()) {
    if (index) {
      const turn = s.turn;
      for (let n = 0; n < 100 && (s.turn === turn || s.active !== 0 || s.step !== 'main1'); n++) {
        const player = s.choice?.player ?? s.priority;
        const command = s.choice
          ? chooseBotCommand(playerView(s, player), player)
          : { type: 'pass', player };
        const result = dispatch(s, command);
        assert.ok(result.ok, JSON.stringify(result.error));
        s = result.state;
      }
      assert.equal(s.step, 'main1');
      assert.equal(s.active, 0);
    }
    s = act(s, 'playLand', { card: card.id });
    s = act(s, 'chooseCreatureType', { creatureType: 'Robot' });
  }
  s = resolve(
    act(s, 'activate', { card: source.id, ability: 0, target: ref(s.objects[victim.id]) }),
  );
  s = resolve(act(s, 'activate', { card: source.id, ability: 1 }));
  assert.equal(s.choice.card, victim.id);
  assert.ok(s.resolving.blinkReturn);
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseCreatureType', { creatureType: 'Wizard' });
  assert.equal(s.choice.card, source.id);
  assert.equal(s.resolving.blinkReturn, undefined);
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseCreatureType', { creatureType: 'Human' });
  assert.equal(s.players[0].life, 21);
  assert.equal(s.resolving, null);
  assert.deepEqual(replay(exportReplay(s)), s);
});
