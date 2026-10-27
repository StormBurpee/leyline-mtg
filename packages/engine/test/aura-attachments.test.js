import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  ref,
  stats,
  keywords,
  legalActions,
  chooseBotCommand,
} from '../src/index.js';
import { move } from '../src/model.js';
import {
  enterBattlefield,
  enterBattlefieldBatch,
  stabilize,
  resolveEffects,
} from '../src/effects.js';
import { nextTurn } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { game } from '../../../apps/web/view.js';

test('Aura casting grants its live bonus and negative toughness kills through state-based actions', () => {
  let s = fixture();
  lands(s, 'Swamp', 1);
  const bear = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Dead Weight', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'graveyard');
  assert.equal(s.objects[aura.id].zone, 'graveyard');
});
test('noncast Aura entry chooses without targeting, including hexproof, and stays in its zone if impossible', () => {
  let s = fixture();
  const aura = put(s, 'Frantic Strength', 0, 'graveyard');
  assert.equal(enterBattlefield(s, aura), true);
  assert.equal(aura.zone, 'graveyard');
  const bear = put(s, 'Grizzly Bears', 1);
  s.modifiers.push({
    objectId: bear.id,
    incarnation: bear.incarnation,
    power: 0,
    toughness: 0,
    keywords: ['hexproof'],
  });
  assert.equal(enterBattlefield(s, aura), false);
  assert.equal(s.choice.kind, 'auraEntry');
  assert.ok(s.choice.cards.includes(bear.id));
  assert.ok(legalActions(s, 0).some((a) => a.type === 'chooseAuraAttachment'));
  const html = game(
    s,
    {
      mode: 'bot',
      chosen: [],
      blocks: [],
      activation: null,
      controlMode: 'smart',
      stops: {},
      view: 'play',
      sideTab: 'stack',
    },
    {},
  );
  assert.match(html, /View cards &amp; choose|View cards & choose/);
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.objects[aura.id].zone, 'battlefield');
  assert.equal(stats(s, s.objects[bear.id]).power, 4);
});
test('simultaneous Aura entrants retain all choices and enter together', () => {
  let s = fixture();
  const bear = put(s, 'Grizzly Bears'),
    a = put(s, 'Frantic Strength', 0, 'graveyard'),
    b = put(s, 'Untamed Hunger', 0, 'graveyard');
  enterBattlefieldBatch(s, [{ object: a }, { object: b }]);
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.choice.kind, 'auraEntry');
  assert.equal(s.objects[a.id].zone, 'graveyard');
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.objects[a.id].zone, 'battlefield');
  assert.equal(s.objects[b.id].zone, 'battlefield');
  assert.equal(stats(s, s.objects[bear.id]).power, 6);
});
test('enchant-you-control restrictions are rechecked but gaining hexproof does not detach an Aura', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const bear = put(s, 'Grizzly Bears'),
    aura = put(s, "Aquitect's Defenses", 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  s = resolve(s);
  assert.ok(keywords(s, s.objects[bear.id]).includes('hexproof'));
  assert.equal(s.objects[aura.id].zone, 'battlefield');
  s.objects[bear.id].controller = 1;
  stabilize(s);
  assert.equal(s.objects[aura.id].zone, 'graveyard');
});
test('attached-subject triggers preserve the enchanted creature when their Aura leaves before resolution', () => {
  let s = fixture();
  lands(s, 'Forest', 7);
  const bear = put(s, 'Grizzly Bears'),
    aura = put(s, 'Colossification', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 22);
  move(s, s.objects[aura.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[bear.id].tapped, true);
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
});
test('no-untap Auras suppress only the normal untap step, not explicit untap effects', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const bear = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Charmed Sleep', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.objects[bear.id].tapped, true);
  nextTurn(s);
  assert.equal(s.objects[bear.id].tapped, true);
  resolveEffects(s, { controller: 0, target: ref(s.objects[bear.id]), effects: [{ op: 'untap' }] });
  assert.equal(s.objects[bear.id].tapped, false);
});
test('library search defers continuation until the entering Aura attachment is chosen', () => {
  let s = fixture();
  const bear = put(s, 'Grizzly Bears'),
    aura = put(s, 'Frantic Strength', 0, 'library');
  const life = s.players[0].life;
  resolveEffects(s, {
    kind: 'ability',
    name: 'Search fixture',
    controller: 0,
    effects: [
      { op: 'searchLibrary', count: 1, where: { type: 'enchantment' }, destination: 'battlefield' },
      { op: 'gainLife', amount: 3 },
    ],
  });
  s = act(s, 'searchLibrary', { cards: [aura.id] });
  assert.equal(s.choice.kind, 'auraEntry');
  assert.equal(s.players[0].life, life);
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.players[0].life, life + 3);
  assert.equal(s.resolving, null);
  assert.equal(s.objects[aura.id].attachedTo.id, bear.id);
});
test('Cooped Up exiles its attached creature using last-known attachment after removal', () => {
  let s = fixture();
  lands(s, 'Plains', 6);
  const bear = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Cooped Up', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  s = act(s, 'activate', { card: aura.id, ability: 0 });
  move(s, s.objects[aura.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'exile');
});
test('Wingspan Stride returns only its source and the bot does not bounce it pointlessly', () => {
  let s = fixture();
  lands(s, 'Island', 6);
  const bear = put(s, 'Grizzly Bears'),
    aura = put(s, 'Wingspan Stride', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  assert.notEqual(chooseBotCommand(s, 0)?.type, 'activate');
  s = act(s, 'activate', { card: aura.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[aura.id].zone, 'hand');
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
});
