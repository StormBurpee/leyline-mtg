import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, resolve, lands } from './helpers.js';
import { dispatch, legalActions } from '../src/index.js';
import { move, keywords } from '../src/model.js';
import { enterBattlefield, stabilize } from '../src/effects.js';

test("Agna Qel'a checks basic lands and loots with its printed activation", () => {
  let s = fixture();
  const a = put(s, "Agna Qel'a", 0, 'hand');
  s = act(s, 'playLand', { card: a.id });
  assert.equal(s.objects[a.id].tapped, true);
  s = fixture();
  lands(s, 'Island', 4);
  const b = put(s, "Agna Qel'a", 0, 'hand');
  s = act(s, 'playLand', { card: b.id });
  assert.equal(s.objects[b.id].tapped, false);
  s = act(s, 'activate', { card: b.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 1);
});

test('Beza evaluates all four comparisons at resolution', () => {
  let s = fixture();
  lands(s, 'Island', 2, 1);
  put(s, 'Llanowar Elves', 1);
  put(s, 'Llanowar Elves', 1);
  put(s, 'Island', 1, 'hand');
  s.players[1].life = 25;
  const b = put(s, 'Beza, the Bounding Spring', 0, 'hand');
  enterBattlefield(s, b);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 24);
  assert.equal(s.players[0].hand.length, 1);
  const ours = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.controller === 0,
  );
  assert.equal(ours.filter((o) => o.name === 'Treasure Token').length, 1);
  assert.equal(ours.filter((o) => o.name === 'Blue Fish Token').length, 2);
});

test('Erode grants the destroyed creatures controller a separate optional search', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const v = put(s, 'Llanowar Elves', 1);
  const c = put(s, 'Erode', 0, 'hand');
  s = act(s, 'cast', {
    card: c.id,
    target: { kind: 'object', id: v.id, incarnation: v.incarnation },
  });
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'graveyard');
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.optional, true);
  const before = [...s.players[1].library];
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  assert.deepEqual(s.players[1].library, before);
  assert.equal(s.objects[c.id].zone, 'graveyard');
});

test('Erode still allows search when indestructibility stops destruction', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const v = put(s, 'Llanowar Elves', 1);
  s.modifiers.push({
    objectId: v.id,
    incarnation: v.incarnation,
    keywords: ['indestructible'],
    expires: s.turn,
  });
  const c = put(s, 'Erode', 0, 'hand');
  s = act(s, 'cast', {
    card: c.id,
    target: { kind: 'object', id: v.id, incarnation: v.incarnation },
  });
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'battlefield');
  assert.equal(s.choice.player, 1);
});

test('Settle exiles only targeted players attackers and searches that exact count', () => {
  let s = fixture();
  lands(s, 'Plains', 4);
  const a = put(s, 'Llanowar Elves', 1),
    b = put(s, 'Llanowar Elves', 1),
    other = put(s, 'Llanowar Elves', 0);
  s.combat.attackers = [a, b, other].map((o) => ({
    kind: 'object',
    id: o.id,
    incarnation: o.incarnation,
  }));
  const c = put(s, 'Settle the Wreckage', 0, 'hand');
  s = act(s, 'cast', { card: c.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.objects[a.id].zone, 'exile');
  assert.equal(s.objects[b.id].zone, 'exile');
  assert.equal(s.objects[other.id].zone, 'battlefield');
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.max, 2);
  const ids = s.choice.cards.slice(0, 2);
  s = act(s, 'searchLibrary', { cards: ids });
  for (const id of ids) {
    assert.equal(s.objects[id].zone, 'battlefield');
    assert.equal(s.objects[id].controller, 1);
    assert.equal(s.objects[id].tapped, true);
  }
});

test('Rest in Peace empties both graveyards and replaces deaths, discards and spell resolution', () => {
  let s = fixture();
  const dead = put(s, 'Llanowar Elves', 1, 'graveyard'),
    own = put(s, 'Island', 0, 'graveyard');
  const rip = put(s, 'Rest in Peace', 0, 'hand');
  enterBattlefield(s, rip);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[dead.id].zone, 'exile');
  assert.equal(s.objects[own.id].zone, 'exile');
  lands(s, 'Plains', 1);
  const v = put(s, 'Llanowar Elves', 1);
  const e = put(s, 'Erode', 0, 'hand');
  s = act(s, 'cast', {
    card: e.id,
    target: { kind: 'object', id: v.id, incarnation: v.incarnation },
  });
  s = resolve(s);
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  assert.equal(s.objects[v.id].zone, 'exile');
  assert.equal(s.objects[e.id].zone, 'exile');
});

test('Pinnacle Starcage exiles small artifacts and creatures and returns exact linked objects', () => {
  let s = fixture();
  const v = put(s, 'Llanowar Elves', 1),
    treasure = put(s, 'Treasure Token', 1),
    big = put(s, 'Beza, the Bounding Spring', 1);
  const cage = put(s, 'Pinnacle Starcage', 0, 'hand');
  enterBattlefield(s, cage);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'exile');
  assert.notEqual(s.objects[treasure.id]?.zone, 'battlefield');
  assert.equal(s.objects[big.id].zone, 'battlefield');
  lands(s, 'Plains', 8);
  s = act(s, 'activate', { card: cage.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'graveyard');
  assert.equal(s.objects[cage.id].zone, 'graveyard');
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Robot Token')
      .length,
    1,
  );
});

test('Pinnacle Starcage creates no Robots for graveyard moves replaced by Rest in Peace', () => {
  let s = fixture();
  const v = put(s, 'Llanowar Elves', 1);
  const cage = put(s, 'Pinnacle Starcage', 0, 'hand');
  enterBattlefield(s, cage);
  stabilize(s);
  s = resolve(s);
  put(s, 'Rest in Peace');
  lands(s, 'Plains', 8);
  s = act(s, 'activate', { card: cage.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[v.id].zone, 'exile');
  assert.equal(s.objects[cage.id].zone, 'exile');
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Robot Token')
      .length,
    0,
  );
});

test('Captain Marvel power-up discounts mana cost only on entry turn and is once per object', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const c = put(s, "Captain Marvel, Earth's Protector");
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 1);
  assert.equal(s.objects[c.id].keywordCounters.indestructible, 1);
  assert.equal(s.objects[c.id].powerUpUses[0], s.objects[c.id].incarnation);
});

test('Power-up remains spent after countering, resets on blink, and stops discounting next turn', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const c = put(s, "Captain Marvel, Earth's Protector");
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s.stack = [];
  s.turn++;
  assert.equal(dispatch(s, { type: 'activate', player: 0, card: c.id, ability: 0 }).ok, false);
  move(s, s.objects[c.id], 'exile');
  enterBattlefield(s, s.objects[c.id]);
  lands(s, 'Island', 2);
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.ok(keywords(s, s.objects[c.id]).includes('indestructible'));
  move(s, s.objects[c.id], 'exile');
  enterBattlefield(s, s.objects[c.id]);
  s.turn++;
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'activate' && a.card === c.id),
    false,
  );
  lands(s, 'Plains', 7);
  s = act(s, 'activate', { card: c.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[c.id].plusCounters, 1);
});

test('Petrified Hamlet names lands publicly, disables only nonmana abilities and grants colorless', () => {
  let s = fixture();
  const agna = put(s, "Agna Qel'a", 1);
  lands(s, 'Island', 3, 1);
  const hamlet = put(s, 'Petrified Hamlet', 0, 'hand');
  enterBattlefield(s, hamlet);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'landName');
  s = act(s, 'chooseLandName', { name: "Agna Qel'a" });
  s.priority = 1;
  assert.equal(
    legalActions(s, 1).some((a) => a.type === 'activate' && a.card === agna.id),
    false,
  );
  assert.ok(
    legalActions(s, 1).some((a) => a.type === 'tapMana' && a.card === agna.id && a.color === 'C'),
  );
  move(s, s.objects[hamlet.id], 'graveyard');
  assert.ok(legalActions(s, 1).some((a) => a.type === 'activate' && a.card === agna.id));
  assert.equal(
    legalActions(s, 1).some((a) => a.type === 'tapMana' && a.card === agna.id && a.color === 'C'),
    false,
  );
});

test('Ultima destroys creatures/artifacts, erases their waiting death triggers and skips end step', () => {
  let s = fixture();
  lands(s, 'Plains', 5);
  const d = put(s, 'Zulaport Cutthroat', 1),
    t = put(s, 'Treasure Token', 1);
  const c = put(s, 'Ultima', 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  assert.equal(s.objects[d.id].zone, 'graveyard');
  assert.equal(s.objects[c.id].zone, 'exile');
  assert.equal(s.objects[t.id], undefined);
  assert.equal(
    Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Zombie Token'),
    false,
  );
  assert.equal(s.active, 1);
  assert.equal(s.step, 'upkeep');
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.players[1].life, 20);
});

test('Ultima goes straight to maximum-hand-size discard before clearing damage and turn modifiers', () => {
  let s = fixture();
  lands(s, 'Plains', 5);
  const protectedCreature = put(s, "Captain Marvel, Earth's Protector", 1);
  protectedCreature.keywordCounters = { indestructible: 1 };
  protectedCreature.damage = 2;
  for (let i = 0; i < 9; i++) put(s, 'Island', 0, 'hand');
  const c = put(s, 'Ultima', 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  assert.equal(s.step, 'cleanup');
  assert.equal(s.choice.kind, 'discard');
  assert.equal(s.choice.count, 2);
  s = act(s, 'discard', { cards: s.players[0].hand.slice(0, 2) });
  assert.equal(s.objects[protectedCreature.id].damage, 0);
  assert.equal(s.active, 1);
});

test('Three Steps Ahead offers all seven nonempty Spree subsets and draw-only costs 2U', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const c = put(s, 'Three Steps Ahead', 0, 'hand');
  s = act(s, 'cast', { card: c.id, mode: 3 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 2);
});

test('Three Steps Ahead combines counter, copy and draw with locked additional costs and original mana value', () => {
  let s = fixture();
  lands(s, 'Island', 8);
  const bear = put(s, 'Llanowar Elves', 0);
  const spell = put(s, 'Shock', 1, 'hand');
  lands(s, 'Mountain', 1, 1);
  s.priority = 1;
  s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 0 } }, 1);
  const targetSpell = s.stack.at(-1).id;
  s.priority = 0;
  const c = put(s, 'Three Steps Ahead', 0, 'hand');
  s = act(s, 'cast', {
    card: c.id,
    mode: 6,
    targets: {
      counter: [{ kind: 'stack', id: targetSpell }],
      copy: [{ kind: 'object', id: bear.id, incarnation: bear.incarnation }],
    },
  });
  assert.equal(s.stack.at(-1).sourceDefinition.cost.U, 1);
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Llanowar Elves')
      .length,
    2,
  );
  assert.equal(s.choice.kind, 'discardEffect');
});

test('Spree copy entry choice pauses before later draw/discard and resumes the same spell', () => {
  let s = fixture();
  lands(s, 'Island', 6);
  const cavern = put(s, 'Cavern of Souls');
  cavern.chosenCreatureType = 'Elf';
  s.modifiers.push({
    objectId: cavern.id,
    incarnation: cavern.incarnation,
    expires: s.turn,
    animation: { power: 2, toughness: 2, colors: [], subtypes: ['Elemental'] },
    addTypes: ['creature'],
  });
  const c = put(s, 'Three Steps Ahead', 0, 'hand');
  s = act(s, 'cast', {
    card: c.id,
    mode: 5,
    targets: { copy: [{ kind: 'object', id: cavern.id, incarnation: cavern.incarnation }] },
  });
  s = resolve(s);
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.players[0].hand.length, 0);
  s = act(s, 'chooseCreatureType', { creatureType: 'Lizard' });
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 2);
});
