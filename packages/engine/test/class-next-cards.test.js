import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  CARD_IDS,
  createRegistry,
  createGame,
  dispatch,
  definition,
  stats,
  keywords,
  playerView,
  chooseBotCommand,
  exportReplay,
  replay,
  validateEventSpec,
} from '../src/index.js';
import {
  ref,
  move,
  addModifier,
  notifyTriggers,
  sacrificePermanents,
  copiableDefinition,
} from '../src/model.js';
import {
  enterBattlefield,
  enterBattlefieldBatch,
  stabilize,
  resolveEffects,
  dealDamage,
  dealDamageBatch,
} from '../src/effects.js';
import {
  declareAttackers,
  canAttack,
  canBlock,
  beginDamage,
  assignDamage,
  suggestedDamage,
} from '../src/combat.js';
import { finishCleanup } from '../src/turn.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { inspect } from '../../../apps/web/view.js';
import { activatedAbilityButtons } from '../../../apps/web/ability-controls.js';
import { legalActions } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';

const slugs = ['leader-s-talent', 'gossip-s-talent', 'does-machines'];
const sources = slugs.map((slug) =>
  JSON.parse(fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url))),
);
const mechanics = JSON.parse(
  fs.readFileSync(new URL('../../cards/mechanics.json', import.meta.url)),
);
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const compiled = sources.map((s) => {
  const r = compileCard(s, { mechanics, identities });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  return r.definition;
});
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(compiled.map((d) => [d.name, d])),
});
function setup() {
  const s = fixture();
  s.catalog = catalog;
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
}
function effect(s, effects, extra = {}) {
  return resolveEffects(s, {
    kind: 'ability',
    name: 'probe',
    controller: 0,
    source: null,
    sourceKeywords: [],
    effects,
    ...extra,
  });
}
function settle(s) {
  stabilize(s);
  for (
    let n = 0;
    n < 100 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    n++
  ) {
    const p = s.choice?.player ?? s.priority;
    const result = dispatch(
      s,
      s.choice ? chooseBotCommand(playerView(s, p), p) : { type: 'pass', player: p },
    );
    assert.ok(result.ok, JSON.stringify(result.error));
    s = result.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
  return s;
}
function reject(s, command) {
  const before = JSON.stringify(s);
  assert.equal(dispatch(s, { player: s.choice?.player ?? s.priority, ...command }).ok, false);
  assert.equal(JSON.stringify(s), before);
}
function damageSource(s, o) {
  return {
    ...ref(o),
    controller: o.controller,
    definition: definition(s, o),
    keywords: keywords(s, o),
  };
}
function combatHit(s, o, amount = 1) {
  dealDamageBatch(
    s,
    [{ source: damageSource(s, o), target: { kind: 'player', id: 1 }, amount }],
    true,
  );
  stabilize(s);
}
function chooseTarget(s, o) {
  assert.equal(s.choice?.kind, 'triggerTarget');
  return act(s, 'chooseTriggerTarget', { target: ref(o) });
}
function animate(s, o, power = 0, toughness = 0) {
  effect(s, [{ op: 'animatePermanent', power, toughness, subtypes: ['Robot'] }], {
    target: ref(o),
  });
}
function combatTrigger(s, o) {
  notifyTriggers(s, 'step', { step: 'beginCombat', player: 0 });
  stabilize(s);
  return chooseTarget(s, o);
}

test('three complete Class sources validate and preserve native/source round trips', () => {
  const schema = new Ajv({ strict: true }).compile(
    JSON.parse(fs.readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url))),
  );
  for (const [i, s] of sources.entries()) {
    assert.ok(schema(s), JSON.stringify(schema.errors));
    const result = compileCard(
      sourceFromDefinition(compiled[i], {
        id: s.id,
        idsByName: Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id])),
      }),
      { mechanics, identities },
    );
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, compiled[i]);
    assert.deepEqual(
      compiled[i].classLevels.map((l) => l.level),
      [2, 3],
    );
  }
});
test('historical counter predicate is limited to departure event families and matches either boolean', () => {
  for (const event of [
    'leave',
    'dies',
    'diesGroup',
    'battlefieldToGraveyard',
    'battlefieldToGraveyardGroup',
  ])
    for (const hadCounters of [true, false])
      assert.deepEqual(validateEventSpec({ event, hadCounters }), []);
  for (const event of ['enter', 'cast', 'attackGroup', 'combatDamagePlayer', 'step'])
    assert.ok(validateEventSpec({ event, hadCounters: true }).length);
  assert.ok(validateEventSpec({ event: 'leave', hadCounters: 1 }).length);
  for (const hadCounters of [true, false]) {
    const s = setup(),
      witness = put(s, 'Grizzly Bears');
    witness.definitionOverride = {
      ...CARDS['Grizzly Bears'],
      triggers: [
        { event: { event: 'leave', hadCounters }, effects: [{ op: 'gainLife', amount: 1 }] },
      ],
    };
    const a = put(s, 'Hill Giant'),
      b = put(s, 'Hill Giant');
    a.plusCounters = 1;
    move(s, a, 'hand');
    move(s, b, 'exile');
    assert.equal(s.pendingTriggers.length, 1);
    assert.equal(s.pendingTriggers[0].eventSource.id, hadCounters ? a.id : b.id);
  }
});
test('Leader attacks once per declaration, targets an attacking creature, and counters before damage', () => {
  let s = setup();
  put(s, "Leader's Talent");
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Hill Giant'),
    idle = put(s, 'Grizzly Bears');
  s.step = 'attack';
  declareAttackers(s, [a.id, b.id]);
  stabilize(s);
  reject(s, { type: 'chooseTriggerTarget', target: ref(idle) });
  s = chooseTarget(s, a);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 0);
});
test('Leader level two uses predeparture counters of every supported kind, not the new object', () => {
  for (const field of [
    'plusCounters',
    'minusCounters',
    'stunCounters',
    'loreCounters',
    'loyalty',
    'questCounters',
    'chargeCounters',
    'keywordCounters',
  ])
    for (const zone of ['hand', 'exile', 'graveyard', 'library']) {
      let s = setup();
      const talent = put(s, "Leader's Talent");
      talent.classLevel = 2;
      const c = put(s, 'Hill Giant');
      c[field] = field === 'keywordCounters' ? { flying: 1 } : 1;
      const before = s.players[0].life;
      move(s, c, zone);
      assert.equal(s.pendingTriggers.length, 1, `${field}/${zone}`);
      assert.equal(s.pendingTriggers[0].condition, undefined);
      move(s, talent, 'graveyard');
      if (zone !== 'battlefield') enterBattlefield(s, c, 1); // new counterless incarnation must not cancel historical condition
      s = settle(s);
      assert.equal(s.players[0].life, before + 2, `${field}/${zone}`);
    }
});
test('Leader ignores counterless, opposing, noncreature and later-added counters', () => {
  const s = setup(),
    talent = put(s, "Leader's Talent");
  talent.classLevel = 2;
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Hill Giant', 1),
    c = put(s, 'Mind Stone');
  b.plusCounters = 1;
  c.chargeCounters = 2;
  move(s, a, 'hand');
  a.plusCounters = 1;
  move(s, b, 'graveyard');
  move(s, c, 'exile');
  assert.equal(s.pendingTriggers.length, 0);
  talent.classLevel = 3;
  move(s, talent, 'graveyard');
  assert.equal(s.pendingTriggers.length, 0); // level designation is not a counter
});
test('Leader simultaneous departures retain Class grants and each creature counter snapshot', () => {
  let s = setup();
  const talent = put(s, "Leader's Talent");
  talent.classLevel = 2;
  animate(s, talent, 2, 2);
  talent.plusCounters = 1;
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Hill Giant');
  a.plusCounters = 1;
  sacrificePermanents(s, [talent, a, b]);
  assert.equal(s.pendingTriggers.length, 2);
  s = settle(s);
  assert.equal(s.players[0].life, 24);
});
test('Leader level three cast trigger resolves before spell and survives source or spell loss', () => {
  let s = setup();
  const talent = put(s, "Leader's Talent");
  talent.classLevel = 3;
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Hill Giant', 1),
    spell = put(s, 'Llanowar Elves', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).name, talent.name);
  move(s, s.objects[talent.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 0);
  assert.equal(s.objects[spell.id].plusCounters, 0);
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'battlefield');
  assert.equal(s.objects[spell.id].plusCounters, 0);
  const t = put(s, "Leader's Talent");
  t.classLevel = 3;
  const spell2 = put(s, 'Llanowar Elves', 0, 'hand');
  s = act(s, 'cast', { card: spell2.id });
  const removed = s.stack.shift();
  move(s, s.objects[removed.source.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 2);
});
test('Gossip surveils once per own entering creature including each member of a batch', () => {
  let s = setup();
  put(s, "Gossip's Talent");
  const a = put(s, 'Grizzly Bears', 0, 'hand'),
    b = put(s, 'Hill Giant', 0, 'hand'),
    c = put(s, 'Grizzly Bears', 1, 'hand');
  enterBattlefieldBatch(s, [{ object: a }, { object: b }, { object: c }]);
  assert.equal(s.pendingTriggers.length, 2);
  stabilize(s);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  const top = s.choice.cards[0];
  s = act(s, 'orderLibrary', { top: [], rest: [top] });
  assert.equal(s.objects[top].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.stack.length, 0);
});
test('Gossip attack target power is checked on selection and resolution, not after resolution', () => {
  for (const timing of ['before', 'after']) {
    let s = setup();
    const t = put(s, "Gossip's Talent");
    t.classLevel = 2;
    const a = put(s, 'Grizzly Bears'),
      big = put(s, 'Hill Giant'),
      blocker = put(s, 'Hill Giant', 1);
    big.plusCounters = 1;
    s.step = 'attack';
    declareAttackers(s, [a.id, big.id]);
    stabilize(s);
    reject(s, { type: 'chooseTriggerTarget', target: ref(big) });
    s = chooseTarget(s, a);
    if (timing === 'before') s.objects[a.id].plusCounters = 2;
    s = resolve(s);
    if (timing === 'after') s.objects[a.id].plusCounters = 2;
    assert.equal(canBlock(s, s.objects[blocker.id], s.objects[a.id], 1), timing === 'before');
  }
});
test('Gossip combat trigger is optional at resolution and targets neither source nor damaged player', () => {
  for (const accept of [false, true]) {
    let s = setup();
    const t = put(s, "Gossip's Talent");
    t.classLevel = 3;
    const a = put(s, 'Grizzly Bears');
    addModifier(s, {
      objectId: a.id,
      incarnation: a.incarnation,
      keywords: ['shroud'],
      permanent: true,
    });
    a.plusCounters = 2;
    const incarnation = a.incarnation;
    combatHit(s, a);
    assert.equal(s.choice, null);
    assert.equal(s.stack.at(-1).target, undefined);
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    move(s, s.objects[t.id], 'graveyard');
    s = act(s, 'resolveOptional', { accept });
    assert.equal(s.objects[a.id].incarnation, incarnation + (accept ? 2 : 0));
    assert.equal(s.objects[a.id].plusCounters, accept ? 0 : 2);
  }
});
test('Gossip ignores noncombat, nonplayer, zero damage and lost level abilities', () => {
  const s = setup(),
    t = put(s, "Gossip's Talent");
  t.classLevel = 3;
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Hill Giant', 1);
  dealDamage(s, damageSource(s, a), { kind: 'player', id: 1 }, 1, false);
  dealDamage(s, damageSource(s, a), ref(b), 1, true);
  dealDamage(s, damageSource(s, a), { kind: 'player', id: 1 }, 0, true);
  assert.equal(s.pendingTriggers.length, 0);
  addModifier(s, {
    objectId: t.id,
    incarnation: t.incarnation,
    removeAbilities: true,
    permanent: true,
  });
  combatHit(s, a);
  assert.equal(s.stack.length, 0);
});
test('Gossip uses exact event incarnation but does not recheck creature type or controller', () => {
  for (const stale of [false, true]) {
    let s = setup();
    const t = put(s, "Gossip's Talent");
    t.classLevel = 3;
    const a = put(s, 'Mind Stone');
    animate(s, a, 2, 2);
    combatHit(s, a);
    const incarnation = a.incarnation;
    if (stale) {
      move(s, a, 'hand');
      enterBattlefield(s, a, 0);
    } else {
      s.modifiers = [];
      a.controller = 1;
    }
    move(s, t, 'graveyard');
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept: true });
    assert.equal(s.objects[a.id].incarnation, incarnation + 2);
    assert.equal(s.objects[a.id].controller, 0);
    assert.equal(s.objects[a.id].zone, 'battlefield');
    assert.equal(
      s.events.filter((e) => e.type === 'zoneChange' && e.objectId === a.id && e.to === 'exile')
        .length,
      stale ? 0 : 1,
    );
  }
});
test('Gossip returns stolen cards to owner; accepted token blink never returns a token', () => {
  for (const token of [false, true]) {
    let s = setup();
    const t = put(s, "Gossip's Talent");
    t.classLevel = 3;
    const a = put(s, token ? 'Soldier Token' : 'Grizzly Bears', 1);
    a.controller = 0;
    combatHit(s, a);
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept: true });
    assert.equal(s.objects[a.id]?.zone, token ? undefined : 'battlefield');
    if (!token) assert.equal(s.objects[a.id].controller, 1);
  }
});
test('Gossip first-strike blink removes double striker from the second combat damage step', () => {
  let s = setup();
  const t = put(s, "Gossip's Talent");
  t.classLevel = 3;
  const a = put(s, 'Grizzly Bears');
  addModifier(s, {
    objectId: a.id,
    incarnation: a.incarnation,
    keywords: ['double strike'],
    permanent: true,
  });
  s.step = 'attack';
  declareAttackers(s, [a.id]);
  s = settle(s);
  s.step = 'firstDamage';
  beginDamage(s, true);
  assignDamage(s, suggestedDamage(s));
  stabilize(s);
  assert.equal(s.players[1].life, 18);
  s = resolve(s);
  s = act(s, 'resolveOptional', { accept: true });
  s = settle(s);
  s.step = 'damage';
  beginDamage(s, false);
  if (s.choice?.kind === 'damage') assignDamage(s, suggestedDamage(s));
  assert.equal(s.players[1].life, 18);
});
test('immediate blink handles source/event/target, owner/you and entry continuation without priority', () => {
  for (const subject of [undefined, 'source', 'eventSource'])
    for (const controller of ['owner', 'you']) {
      const s = setup(),
        a = put(s, 'Grizzly Bears', 1);
      a.controller = 0;
      const r = ref(a);
      effect(s, [{ op: 'blink', ...(subject ? { subject } : {}), controller }], {
        target: r,
        source: r,
        eventSource: r,
      });
      assert.equal(a.controller, controller === 'owner' ? 1 : 0);
      assert.equal(a.incarnation, r.incarnation + 2);
    }
  let s = setup();
  const cavern = put(s, 'Cavern of Souls');
  effect(s, [{ op: 'blink' }, { op: 'gainLife', amount: 4 }], { target: ref(cavern) });
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.players[0].life, 20);
  s = act(s, 'chooseCreatureType', { creatureType: 'Robot' });
  assert.equal(s.objects[cavern.id].chosenCreatureType, 'Robot');
  assert.equal(s.players[0].life, 24);
  assert.equal(s.resolving, null);
});
test('Does Machines enters mill then draw then discard, pausing only after both draws', () => {
  let s = setup();
  const before = [...s.players[0].library],
    machine = put(s, 'Does Machines', 0, 'hand');
  enterBattlefield(s, machine);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].library.length, before.length - 4);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.players[0].graveyard.length, 2);
  const drawn = [...s.players[0].hand];
  s = act(s, 'discardEffect', { cards: drawn });
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.players[0].graveyard.length, 4);
  assert.equal(s.resolving, null);
});
test('Does Machines level two targets zero, one or two distinct own artifact graveyard cards', () => {
  for (const count of [0, 1, 2]) {
    let s = setup();
    const machine = put(s, 'Does Machines'),
      a = put(s, 'Mind Stone', 0, 'graveyard'),
      b = put(s, "Adventurer's Airship", 0, 'graveyard'),
      wrong = put(s, 'Grizzly Bears', 0, 'graveyard'),
      enemy = put(s, 'Mind Stone', 1, 'graveyard');
    s = resolve(act(s, 'activate', { card: machine.id, ability: 0 }));
    assert.equal(s.choice.kind, 'triggerTargets');
    for (const cards of [[a, a], [wrong], [enemy], [a, b, wrong]])
      reject(s, { type: 'chooseTriggerTargets', targets: { cards: cards.map(ref) } });
    s = act(s, 'chooseTriggerTargets', { targets: { cards: [a, b].slice(0, count).map(ref) } });
    move(s, s.objects[machine.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.players[0].hand.length, count);
    assert.equal(s.objects[wrong.id].zone, 'graveyard');
  }
});
test('Does Machines level two returns remaining legal target, never a reincarnated target', () => {
  let s = setup();
  const m = put(s, 'Does Machines'),
    a = put(s, 'Mind Stone', 0, 'graveyard'),
    b = put(s, "Adventurer's Airship", 0, 'graveyard');
  s = resolve(act(s, 'activate', { card: m.id, ability: 0 }));
  s = act(s, 'chooseTriggerTargets', { targets: { cards: [ref(a), ref(b)] } });
  move(s, s.objects[a.id], 'exile');
  move(s, s.objects[a.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('Does Machines level three adds counters before conditional animation, never overwrites creatures', () => {
  for (const alreadyCreature of [false, true]) {
    let s = setup();
    const m = put(s, 'Does Machines');
    m.classLevel = 3;
    const a = put(s, 'Mind Stone');
    if (alreadyCreature) animate(s, a, 4, 5);
    s = combatTrigger(s, a);
    s = resolve(s);
    assert.deepEqual(stats(s, s.objects[a.id]), {
      power: alreadyCreature ? 7 : 3,
      toughness: alreadyCreature ? 8 : 3,
    });
    assert.ok(definition(s, s.objects[a.id]).types.includes('artifact'));
    assert.ok(definition(s, s.objects[a.id]).subtypes.includes('Robot'));
    assert.ok(definition(s, s.objects[a.id]).mana);
  }
});
test('Does Machines animation persists across cleanup/source loss but is not copied or carried through zones', () => {
  let s = setup();
  const m = put(s, 'Does Machines');
  m.classLevel = 3;
  const a = put(s, 'Mind Stone');
  s = combatTrigger(s, a);
  move(s, s.objects[m.id], 'graveyard');
  s = resolve(s);
  finishCleanup(s);
  assert.deepEqual(stats(s, s.objects[a.id]), { power: 3, toughness: 3 });
  assert.equal(copiableDefinition(s, s.objects[a.id]).type, 'artifact');
  move(s, s.objects[a.id], 'hand');
  enterBattlefield(s, s.objects[a.id]);
  assert.equal(definition(s, s.objects[a.id]).type, 'artifact');
  assert.equal(s.objects[a.id].plusCounters, 0);
});
test('Does Machines retains all existing types, abilities, colors, supertypes and subtypes', () => {
  let s = setup();
  const m = put(s, 'Does Machines');
  m.classLevel = 3;
  const a = put(s, 'Mind Stone');
  a.definitionOverride = {
    ...CARDS['Mind Stone'],
    types: ['artifact', 'land'],
    subtypes: ['Equipment', 'Cave'],
    supertypes: ['Legendary'],
    color: ['R'],
    keywords: ['flying'],
  };
  s = combatTrigger(s, a);
  s = resolve(s);
  const d = definition(s, s.objects[a.id]);
  assert.deepEqual(new Set(d.types), new Set(['artifact', 'land', 'creature']));
  assert.deepEqual(new Set(d.subtypes), new Set(['Equipment', 'Cave', 'Robot']));
  assert.deepEqual(d.supertypes, ['Legendary']);
  assert.deepEqual(d.color, ['R']);
  assert.ok(keywords(s, s.objects[a.id]).includes('flying'));
  assert.ok(d.mana);
});
test('Does Machines unhooks animated Equipment and preserves control-duration attack rules', () => {
  for (const ready of [false, true]) {
    let s = setup();
    const m = put(s, 'Does Machines');
    m.classLevel = 3;
    const holder = put(s, 'Grizzly Bears'),
      a = put(s, 'Mind Stone', 0, 'battlefield', { ready });
    a.definitionOverride = {
      ...CARDS['Mind Stone'],
      subtypes: ['Equipment'],
      equip: { mana: { generic: 1 } },
    };
    a.attachedTo = ref(holder);
    s = combatTrigger(s, a);
    s = resolve(s);
    assert.equal(s.objects[a.id].attachedTo, null);
    assert.equal(canAttack(s, s.objects[a.id], 0), ready);
  }
});
test('Does Machines 0/0 Vehicle base survives later crew and Station base survives later threshold', () => {
  for (const name of ["Adventurer's Airship", 'Debris Field Crusher']) {
    let s = setup();
    const m = put(s, 'Does Machines');
    m.classLevel = 3;
    const a = put(s, name),
      crew = put(s, 'Hill Giant');
    s = combatTrigger(s, a);
    s = resolve(s);
    if (name.includes('Airship')) s = resolve(act(s, 'crew', { card: a.id, cards: [crew.id] }));
    else s.objects[a.id].chargeCounters = 8;
    assert.deepEqual(stats(s, s.objects[a.id]), { power: 3, toughness: 3 });
    assert.ok(keywords(s, s.objects[a.id]).includes('flying'));
  }
});
test('Does Machines beginning combat respects controller and target current type/incarnation', () => {
  for (const change of ['opponent', 'notArtifact', 'newObject']) {
    let s = setup();
    const m = put(s, 'Does Machines');
    m.classLevel = 3;
    const a = put(s, 'Mind Stone');
    notifyTriggers(s, 'step', { step: 'beginCombat', player: 1 });
    assert.equal(s.pendingTriggers.length, 0);
    s = combatTrigger(s, a);
    if (change === 'opponent') s.objects[a.id].controller = 1;
    if (change === 'notArtifact')
      s.objects[a.id].definitionOverride = { ...CARDS['Grizzly Bears'], name: a.name };
    if (change === 'newObject') {
      move(s, s.objects[a.id], 'hand');
      enterBattlefield(s, s.objects[a.id]);
    }
    s = resolve(s);
    assert.equal(s.objects[a.id].plusCounters, 0);
  }
});
test('counter-bearing aggregate death predicates require controller, type and counters on the same member', () => {
  for (const event of ['diesGroup', 'battlefieldToGraveyardGroup']) {
    const s = setup(),
      w = put(s, 'Mind Stone');
    w.definitionOverride = {
      ...CARDS['Mind Stone'],
      triggers: [
        {
          event: { event, controller: 'you', filter: { type: 'creature' }, hadCounters: true },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    };
    const own = put(s, 'Grizzly Bears'),
      enemy = put(s, 'Hill Giant', 1),
      artifact = put(s, 'Mind Stone');
    enemy.plusCounters = 1;
    artifact.chargeCounters = 1;
    sacrificePermanents(s, [own, enemy, artifact]);
    assert.equal(s.pendingTriggers.length, 0);
    const counted = put(s, 'Grizzly Bears');
    counted.stunCounters = 1;
    sacrificePermanents(s, [counted]);
    assert.equal(s.pendingTriggers.length, 1);
  }
});
test('blink and permanent animation fail closed on unsupported bindings, fields, statistics and batches', () => {
  const base = { name: 'Invalid primitive', type: 'instant', cost: {}, target: 'permanent' };
  for (const effects of [
    [{ op: 'blink', subject: 'attached' }],
    [{ op: 'blink', controller: 'opponent' }],
    [{ op: 'blink', until: 'endOfTurn' }],
    [{ op: 'animatePermanent', power: 0, toughness: 0, subtypes: ['Robot'], colors: ['U'] }],
    [{ op: 'animatePermanent', power: Infinity, toughness: 0, subtypes: ['Robot'] }],
    [{ op: 'animatePermanent', power: 0, toughness: 0, subtypes: ['Equipment'] }],
    [{ op: 'animatePermanent', power: 0, toughness: 0, subtypes: ['Robot'], subject: 'source' }],
  ])
    assert.throws(() => createRegistry({ [base.name]: { ...base, effects } }));
  for (const op of ['blink', 'animatePermanent']) {
    const e = op === 'blink' ? { op } : { op, power: 0, toughness: 0, subtypes: ['Robot'] };
    assert.throws(() =>
      createRegistry({ Bad: { ...base, name: 'Bad', target: 'player', effects: [e] } }),
    );
    assert.throws(() =>
      createRegistry({
        Bad: {
          ...base,
          name: 'Bad',
          target: undefined,
          targetGroups: [{ id: 'objects', selector: 'permanent', min: 0, max: 2 }],
          effects: [{ ...e, targetGroup: 'objects' }],
        },
      }),
    );
  }
  for (const mutation of [
    (e) => (e.until = 'endOfTurn'),
    (e) => (e.target = 'source'),
    (e) => (e.subtypes = ['Equipment']),
  ]) {
    const source = structuredClone(sources[2]);
    const e = source.abilities[2].abilities[0].effects[1].then[0];
    mutation(e);
    assert.equal(compileCard(source).ok, false);
  }
});
test('single grouped blink with an entry choice resumes the parent effect sequence exactly once', () => {
  let s = setup();
  const cavern = put(s, 'Cavern of Souls');
  effect(
    s,
    [
      { op: 'blink', targetGroup: 'object' },
      { op: 'gainLife', amount: 3 },
    ],
    {
      targetGroups: [{ id: 'object', selector: 'permanent', min: 1, max: 1 }],
      targets: { object: [ref(cavern)] },
    },
  );
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.players[0].life, 20);
  s = act(s, 'chooseCreatureType', { creatureType: 'Robot' });
  assert.equal(s.players[0].life, 23);
  assert.equal(s.resolving, null);
});
test('two Gossip combat hits create separate optional exact-source triggers that survive Class departure', () => {
  let s = setup();
  const talent = put(s, "Gossip's Talent");
  talent.classLevel = 3;
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Hill Giant');
  const initial = [a.incarnation, b.incarnation];
  dealDamageBatch(
    s,
    [a, b].map((o) => ({
      source: damageSource(s, o),
      target: { kind: 'player', id: 1 },
      amount: 1,
    })),
    true,
  );
  assert.equal(s.pendingTriggers.length, 2);
  stabilize(s);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  move(s, s.objects[talent.id], 'graveyard');
  for (let i = 0; i < 2; i++) {
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    s = act(s, 'resolveOptional', { accept: true });
  }
  assert.deepEqual(
    [s.objects[a.id].incarnation, s.objects[b.id].incarnation],
    initial.map((n) => n + 2),
  );
  assert.equal(s.stack.length, 0);
});
test('opaque bot declines optional blink of tokens, stolen creatures and remaining double-strike damage', () => {
  for (const kind of ['token', 'stolen', 'doubleStrike', 'ordinary']) {
    let s = setup();
    const talent = put(s, "Gossip's Talent");
    talent.classLevel = 3;
    const a = put(
      s,
      kind === 'token' ? 'Soldier Token' : 'Grizzly Bears',
      kind === 'stolen' ? 1 : 0,
    );
    a.controller = 0;
    if (kind === 'doubleStrike') {
      s.step = 'firstDamage';
      addModifier(s, {
        objectId: a.id,
        incarnation: a.incarnation,
        keywords: ['double strike'],
        permanent: true,
      });
    }
    combatHit(s, a);
    s = resolve(s);
    const command = chooseBotCommand(playerView(s, 0), 0);
    assert.equal(command.type, 'resolveOptional');
    assert.equal(command.accept, kind === 'ordinary');
    assert.equal(dispatch(s, command).ok, true);
  }
});
test('opaque bots can finish all three complete Class level-ups and their resulting choices', () => {
  for (const name of sources.map((s) => s.name)) {
    let s = setup();
    const talent = put(s, name);
    put(s, 'Mind Stone', 0, 'graveyard');
    put(s, 'Grizzly Bears');
    for (const index of [0, 1]) {
      s = resolve(act(s, 'activate', { card: talent.id, ability: index }));
      s = settle(s);
      assert.equal(s.objects[talent.id].classLevel, index + 2);
    }
    notifyTriggers(s, 'step', { step: 'beginCombat', player: 0 });
    s = settle(s);
    assert.equal(s.choice, null);
  }
});
test('new primitives and historical counter predicate replay deterministically from embedded catalog', () => {
  const artifact = { ...CARDS['Mind Stone'], name: 'Replay artifact', cost: {} };
  const probe = {
    name: 'Replay Class',
    type: 'enchantment',
    types: ['enchantment'],
    subtypes: ['Class'],
    cost: {},
    classLevels: [
      {
        level: 2,
        cost: {},
        abilities: {
          triggers: [
            {
              event: { event: 'leave', hadCounters: true },
              effects: [{ op: 'gainLife', amount: 2 }],
            },
          ],
          activated: [{ cost: {}, target: 'artifact', effects: [{ op: 'blink' }] }],
        },
      },
      {
        level: 3,
        cost: {},
        abilities: {
          activated: [
            {
              cost: {},
              target: 'artifact',
              effects: [
                { op: 'counterOn', amount: 3 },
                { op: 'animatePermanent', power: 0, toughness: 0, subtypes: ['Robot'] },
              ],
            },
          ],
        },
      },
    ],
  };
  const registry = createRegistry({ ...catalog, [probe.name]: probe, [artifact.name]: artifact });
  let s = createGame({
    catalog: registry,
    mulligan: false,
    minimumDeckSize: 0,
    seed: 3,
    decks: [
      [...Array(4).fill(probe.name), ...Array(4).fill(artifact.name), ...Array(4).fill('Forest')],
      Array(12).fill('Island'),
    ],
  });
  while (s.step !== 'main1') s = resolve(s);
  const card = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === probe.name),
    a = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === artifact.name);
  assert.ok(card && a);
  s = resolve(act(s, 'cast', { card: card.id }));
  s = resolve(act(s, 'cast', { card: a.id }));
  s = resolve(act(s, 'activate', { card: card.id, ability: 0 }));
  s = resolve(act(s, 'activate', { card: card.id, ability: 1 }));
  s = resolve(act(s, 'activate', { card: card.id, ability: 3, target: ref(s.objects[a.id]) }));
  assert.deepEqual(stats(s, s.objects[a.id]), { power: 3, toughness: 3 });
  s = resolve(act(s, 'activate', { card: card.id, ability: 2, target: ref(s.objects[a.id]) }));
  s = settle(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[a.id].plusCounters, 0);
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('new complete Classes expose readable level costs, full level text and stable controls in an isolated catalog', () => {
  for (const source of sources) {
    const s = setup(),
      o = put(s, source.name);
    const metadata = {
      [source.name]: {
        oracle_id: source.id,
        oracle_text: source.rulesText,
        mana_cost: source.characteristics.manaCost,
      },
    };
    for (const level of [1, 2, 3]) {
      o.classLevel = level;
      const html = inspect(source.name, metadata, s, o.id, 0);
      assert.match(html, new RegExp(`Class level ${level}`));
      assert.match(html, /Level 2/);
      assert.match(html, /Level 3/);
      const view = playerView(s, 0);
      const controls = activatedAbilityButtons(view, 0, view.objects[o.id], legalActions(view, 0));
      assert.match(controls, /Level 2/);
      assert.match(controls, /Level 3/);
      assert.ok(controls.includes(source.abilities[1].cost));
      assert.ok(controls.includes(source.abilities[2].cost));
    }
  }
});
