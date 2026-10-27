import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  definition,
  keywords,
  ref,
  stats,
  chooseBotCommand,
} from '../packages/engine/src/index.js';
import {
  addModifier,
  captureDepartureContext,
  copiableDefinition,
  finishDepartureBatch,
  move,
  removeOneCounter,
  wardCosts,
} from '../packages/engine/src/model.js';
import { enterBattlefield, resolveEffects, stabilize } from '../packages/engine/src/effects.js';
import { fixture, put, act } from '../packages/engine/test/helpers.js';
import { compilePack } from '../packages/cards/pack.js';
import { stationSources } from './helpers/station-catalog.js';
import { readFileSync } from 'node:fs';

// Independent integration checks against the released catalog, rather than a
// Station-only registry. CR effective 2026-09-25: 506.4, 613.6, 702.184,
// 704.5m, 707.2 and 721.2; EOE release notes, Station general notes.
function settle(s) {
  stabilize(s);
  for (let i = 0; i < 80 && (s.choice || s.stack.length || s.resolving); i++) {
    const command = s.choice ? chooseBotCommand(s, s.choice.player) : { type: 'pass' };
    s = act(s, command.type, command);
  }
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
  assert.equal(s.stack.length, 0);
  return s;
}
function role(s, name, ship, controller = 0) {
  const token = put(s, name, controller, 'void');
  enterBattlefield(s, token, controller, ref(ship));
  return token;
}
const entry = (source, effects) => ({
  id: 'station-review',
  kind: 'ability',
  name: source.name,
  controller: source.controller,
  source: ref(source),
  effects,
  sourceKeywords: [],
  target: null,
  targetKind: null,
});

test('Station review: every Role becomes illegal after threshold loss, without sacrificing the Spacecraft', () => {
  for (const name of ['Cursed', 'Monster', 'Royal', 'Sorcerer', 'Wicked', 'Young Hero']) {
    let s = fixture();
    const ship = put(s, 'Wurmwall Sweeper');
    ship.chargeCounters = 4;
    const token = role(s, name, ship);
    assert.equal(token.zone, 'battlefield');
    assert.deepEqual(token.attachedTo, ref(ship));
    removeOneCounter(ship, 'charge');
    assert.equal(definition(s, ship).type, 'artifact');
    assert.deepEqual(stats(s, ship), { power: 0, toughness: 0 });
    assert.deepEqual(wardCosts(s, ship), []);
    s = settle(s);
    assert.equal(s.objects[token.id], undefined, name);
    assert.equal(s.objects[ship.id].zone, 'battlefield');
    assert.equal(s.players[1].life, name === 'Wicked' ? 19 : 20);
    assert.equal(
      s.events.some((e) => e.type === 'sacrificed' && e.objectId === token.id),
      false,
    );
    s.objects[ship.id].chargeCounters = 4;
    assert.deepEqual(stats(s, s.objects[ship.id]), { power: 2, toughness: 2 });
    assert.equal(definition(s, s.objects[ship.id]).triggers, undefined);
  }
});

test('Station review: momentary noncreature form removes combat but does not perform premature Aura SBAs', () => {
  let s = fixture();
  const ship = put(s, 'Wurmwall Sweeper'),
    payer = put(s, 'Grizzly Bears');
  ship.chargeCounters = 4;
  const token = role(s, 'Wicked', ship);
  s.combat.attackers = [ref(ship)];
  resolveEffects(s, {
    ...entry(ship, [
      { op: 'removeCounterTrigger', selector: 'creature', effects: [{ op: 'draw', count: 1 }] },
      { op: 'stationCharge' },
    ]),
    stationPayer: ref(payer),
    stationPower: 2,
  });
  s = act(s, 'chooseCounter', { counter: 'charge' });
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 5);
  assert.equal(s.combat.attackers.length, 0);
  assert.equal(s.objects[token.id].zone, 'battlefield');
  assert.deepEqual(stats(s, s.objects[ship.id]), { power: 3, toughness: 3 });
  assert.equal(s.players[1].life, 20);
});

test('Station review: Cursed sets base P/T below counters and remains valid through source ability loss', () => {
  const s = fixture(),
    ship = put(s, 'Lumen-Class Frigate'),
    bear = put(s, 'Grizzly Bears');
  ship.chargeCounters = 12;
  ship.plusCounters = 2;
  const curse = role(s, 'Cursed', ship);
  assert.deepEqual(stats(s, ship), { power: 3, toughness: 3 });
  assert.equal(stats(s, bear).power, 3);
  addModifier(s, {
    objectId: ship.id,
    incarnation: ship.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  stabilize(s);
  assert.equal(curse.zone, 'battlefield');
  assert.equal(definition(s, ship).type, 'creature');
  assert.deepEqual(stats(s, ship), { power: 3, toughness: 3 });
  assert.deepEqual(keywords(s, ship), []);
  assert.equal(stats(s, bear).power, 2);
});

test('Station review: a later animation wins over Cursed, while threshold crossing is not a fresh timestamp', () => {
  const s = fixture(),
    ship = put(s, 'Wurmwall Sweeper');
  ship.chargeCounters = 4;
  role(s, 'Cursed', ship);
  ship.chargeCounters = 3;
  ship.chargeCounters = 4;
  assert.deepEqual(stats(s, ship), { power: 1, toughness: 1 });
  addModifier(s, {
    objectId: ship.id,
    incarnation: ship.incarnation,
    addTypes: ['creature'],
    animation: { power: 7, toughness: 8, subtypes: [] },
    expires: s.turn,
  });
  assert.deepEqual(stats(s, ship), { power: 7, toughness: 8 });
  ship.chargeCounters = 3;
  stabilize(s);
  assert.deepEqual(stats(s, ship), { power: 7, toughness: 8 });
  assert.equal(
    Object.values(s.objects).some((o) => o.name === 'Cursed'),
    true,
  );
});

test('Station review: a Role-enhanced payer uses last battlefield power across simultaneous Aura and payer departure', () => {
  let s = fixture();
  const ship = put(s, 'Wurmwall Sweeper'),
    payer = put(s, 'Grizzly Bears'),
    token = role(s, 'Wicked', payer);
  s = act(s, 'station', { card: ship.id, cards: [payer.id] });
  s.objects[payer.id].plusCounters = 2;
  const context = captureDepartureContext(s);
  move(s, s.objects[token.id], 'graveyard', context);
  move(s, s.objects[payer.id], 'graveyard', context);
  finishDepartureBatch(s, context);
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 5);
  assert.equal(s.players[1].life, 19);
});

test('Station review: payer and source control changes do not retarget or repayer an announced station ability', () => {
  let s = fixture();
  const ship = put(s, 'Wurmwall Sweeper'),
    payer = put(s, 'Grizzly Bears');
  s = act(s, 'station', { card: ship.id, cards: [payer.id] });
  s.objects[ship.id].controller = 1;
  s.objects[payer.id].controller = 1;
  role(s, 'Cursed', s.objects[payer.id], 0);
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 1);
  assert.equal(s.objects[ship.id].controller, 1);
});

test('Station review: copies discard counters and Role grants while retaining every printed threshold', () => {
  let s = fixture();
  const ship = put(s, 'Lumen-Class Frigate');
  ship.chargeCounters = 12;
  role(s, 'Cursed', ship, 0);
  role(s, 'Sorcerer', ship, 1);
  const copyValues = copiableDefinition(s, ship);
  assert.equal(copyValues.type, 'artifact');
  assert.equal(copyValues.triggers, undefined);
  assert.equal(copyValues.baseStats, undefined);
  resolveEffects(s, entry(ship, [{ op: 'copyToken', subject: 'source', count: 1 }]));
  s = settle(s);
  const copy = Object.values(s.objects).find((o) => o.name === ship.name && o.id !== ship.id);
  assert.ok(copy);
  assert.equal(copy.chargeCounters, undefined);
  assert.equal(definition(s, copy).type, 'artifact');
  copy.chargeCounters = 12;
  assert.deepEqual(stats(s, copy), { power: 4, toughness: 6 }); // original Frigate anthem
  assert.equal(definition(s, copy).triggers, undefined);
  assert.deepEqual(keywords(s, copy).sort(), ['flying', 'lifelink']);
});

test('Station review: below-threshold ability loss still permits an already announced charge to animate without grants', () => {
  let s = fixture();
  const ship = put(s, 'Lumen-Class Frigate'),
    payer = put(s, 'Yargle and Multani');
  s = act(s, 'station', { card: ship.id, cards: [payer.id] });
  addModifier(s, {
    objectId: ship.id,
    incarnation: ship.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 18);
  assert.equal(definition(s, s.objects[ship.id]).type, 'creature');
  assert.deepEqual(stats(s, s.objects[ship.id]), { power: 3, toughness: 5 });
  assert.deepEqual(keywords(s, s.objects[ship.id]), []);
  assert.equal(stats(s, s.objects[payer.id]).power, 18);
});

test('Station review: Rescue Skiff returns an Aura without targeting its recipient, or leaves it in the graveyard', () => {
  for (const withRecipient of [false, true]) {
    let s = fixture();
    const aura = put(s, 'Pacifism', 0, 'graveyard');
    const recipient = withRecipient ? put(s, 'Grizzly Bears', 1) : null;
    if (recipient)
      addModifier(s, {
        objectId: recipient.id,
        incarnation: recipient.incarnation,
        keywords: ['hexproof', 'shroud'],
        expires: s.turn,
      });
    const skiff = put(s, 'Rescue Skiff', 0, 'hand');
    s.players[0].mana.W = 6;
    s = act(s, 'cast', { card: skiff.id });
    s = act(act(s, 'pass'), 'pass');
    assert.equal(s.choice.kind, 'triggerTarget');
    s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[aura.id]) });
    s = settle(s);
    assert.equal(s.objects[aura.id].zone, withRecipient ? 'battlefield' : 'graveyard');
    if (recipient) assert.deepEqual(s.objects[aura.id].attachedTo, ref(s.objects[recipient.id]));
    assert.equal(definition(s, s.objects[skiff.id]).type, 'artifact');
  }
});

test('Station review: losing creature type preserves marked damage for a later threshold crossing', () => {
  let s = fixture();
  const ship = put(s, 'Wurmwall Sweeper');
  ship.chargeCounters = 4;
  ship.damage = 2;
  removeOneCounter(ship, 'charge');
  s = settle(s);
  assert.equal(s.objects[ship.id].zone, 'battlefield');
  assert.equal(s.objects[ship.id].damage, 2);
  s.objects[ship.id].chargeCounters = 4;
  s = settle(s);
  assert.equal(s.objects[ship.id].zone, 'graveyard');
});

test('Station review: threshold nested Role creation and death-return attachment references fail closed', () => {
  const source = structuredClone(stationSources.find((c) => c.name === 'Wurmwall Sweeper'));
  const roleSource = JSON.parse(
    readFileSync(new URL('../packages/cards/cards/royal-role.json', import.meta.url)),
  );
  const level = source.abilities.find((a) => a.kind === 'stationLevel');
  level.abilities = [
    {
      kind: 'triggered',
      on: { event: 'attack', object: 'source' },
      effects: [
        {
          op: 'conditional',
          condition: { kind: 'controllerTurn' },
          then: [{ op: 'createAttachedToken', token: roleSource.id, target: 'source' }],
        },
      ],
    },
  ];
  assert.equal(compilePack([source, roleSource]).ok, true);
  const nonAura = structuredClone(roleSource);
  nonAura.abilities = [];
  assert.equal(compilePack([source, nonAura]).ok, false);
  const native = structuredClone(CARDS['Wurmwall Sweeper']);
  native.stationLevels[0].grants.triggers = [
    {
      event: { event: 'attack', object: 'source' },
      effects: [
        {
          op: 'conditional',
          condition: { kind: 'controllerTurn' },
          then: [{ op: 'attachedToken', definition: 'Robot Token', subject: 'source' }],
        },
      ],
    },
  ];
  assert.throws(() => createRegistry({ ...CARDS, [native.name]: native }), /Aura/);
  native.stationLevels[0].grants.triggers[0].effects[0].then = [
    {
      op: 'grantDeathReturn',
      attachedToken: 'Missing Role',
      tapped: true,
    },
  ];
  assert.throws(() => createRegistry({ ...CARDS, [native.name]: native }), /Aura/);
});
