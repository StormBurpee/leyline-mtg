import test from 'node:test';
import assert from 'node:assert/strict';
import { ref, keywords, CARDS, chooseBotCommand, dispatch } from '../src/index.js';
import { definition, copiableDefinition, move, notifyTriggers } from '../src/model.js';
import { stabilize, legalTarget } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('Enduring Curiosity returns as only an enchantment and never triggers a second return when not a creature', () => {
  let s = fixture();
  const cat = put(s, 'Enduring Curiosity');
  move(s, cat, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  const returned = s.objects[cat.id];
  assert.equal(returned.zone, 'battlefield');
  assert.deepEqual(definition(s, returned).types, ['enchantment']);
  assert.deepEqual(definition(s, returned).subtypes, []);
  assert.ok(copiableDefinition(s, returned).types.includes('creature'));
  move(s, returned, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
});

test('Enduring return follows only original graveyard incarnation and owner, not controller', () => {
  let s = fixture();
  const cat = put(s, 'Enduring Curiosity', 1);
  cat.controller = 0;
  move(s, cat, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[cat.id].controller, 1);
  s = fixture();
  const other = put(s, 'Enduring Curiosity');
  move(s, other, 'graveyard');
  stabilize(s);
  move(s, other, 'exile');
  move(s, other, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[other.id].zone, 'graveyard');
});

test('Enduring Curiosity draws separately for each friendly creature dealing combat damage', () => {
  let s = fixture();
  const cat = put(s, 'Enduring Curiosity'),
    elf = put(s, 'Llanowar Elves');
  notifyTriggers(s, 'combatDamagePlayer', { object: cat, player: 0, damagedPlayer: 1, amount: 4 });
  notifyTriggers(s, 'combatDamagePlayer', { object: elf, player: 0, damagedPlayer: 1, amount: 1 });
  stabilize(s);
  if (s.choice?.kind === 'orderTriggers')
    s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  while (s.stack.length) s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
});

test('Floodpits targets only a stunned creature and shuffles both owners independently', () => {
  let s = fixture();
  const fish = put(s, 'Floodpits Drowner'),
    elf = put(s, 'Llanowar Elves', 1);
  lands(s, 'Island', 2);
  const selector = CARDS[fish.name].activated[0].target;
  assert.equal(legalTarget(s, selector, ref(elf), 0), false);
  elf.stunCounters = 1;
  assert.equal(legalTarget(s, selector, ref(elf), 0), true);
  s = act(s, 'activate', { card: fish.id, ability: 0, target: ref(elf) });
  s = resolve(s);
  assert.equal(s.objects[fish.id].zone, 'library');
  assert.equal(s.objects[elf.id].zone, 'library');
  assert.ok(s.players[0].library.includes(fish.id));
  assert.ok(s.players[1].library.includes(elf.id));
  assert.equal(s.events.filter((e) => e.type === 'libraryShuffled').slice(-2).length, 2);
});

test('Floodpits does not shuffle itself after its only target becomes illegal', () => {
  let s = fixture();
  const fish = put(s, 'Floodpits Drowner'),
    elf = put(s, 'Llanowar Elves', 1);
  elf.stunCounters = 1;
  lands(s, 'Island', 2);
  s = act(s, 'activate', { card: fish.id, ability: 0, target: ref(elf) });
  s.objects[elf.id].stunCounters = 0;
  s = resolve(s);
  assert.equal(s.objects[fish.id].zone, 'battlefield');
});

test('Strategic Betrayal makes opponent choose a creature without targeting it, then exiles only their graveyard', () => {
  let s = fixture();
  const spell = put(s, 'Strategic Betrayal', 0, 'hand'),
    enemy = put(s, 'Llanowar Elves', 1),
    mine = put(s, 'Llanowar Elves');
  const dead = put(s, 'Forest', 1, 'graveyard'),
    ownDead = put(s, 'Forest', 0, 'graveyard');
  lands(s, 'Swamp', 2);
  s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.destination, 'exile');
  assert.deepEqual(s.choice.cards, [enemy.id]);
  assert.equal(dispatch(s, { type: 'sacrifice', player: 1, cards: [mine.id] }).ok, false);
  const cmd = chooseBotCommand(s, 1);
  assert.equal(cmd.type, 'sacrifice');
  s = act(s, 'sacrifice', { cards: [enemy.id] }, 1);
  assert.equal(s.objects[enemy.id].zone, 'exile');
  assert.equal(s.objects[dead.id].zone, 'exile');
  assert.equal(s.objects[ownDead.id].zone, 'graveyard');
  assert.equal(
    s.events.some((e) => e.type === 'sacrifice' && e.objectId === enemy.id),
    false,
  );
});
