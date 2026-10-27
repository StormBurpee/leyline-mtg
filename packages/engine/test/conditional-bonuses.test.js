import test from 'node:test';
import assert from 'node:assert/strict';
import { stats, keywords, ref, dispatch, CARDS, createRegistry } from '../src/index.js';
import { move } from '../src/model.js';
import { nextTurn, advanceStep } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('artifact-count and another-subtype conditions update live without recursion', () => {
  const s = fixture(),
    goblin = put(s, 'Goblin Tomb Raider'),
    faerie = put(s, 'Barrow Naughty');
  assert.ok(!keywords(s, goblin).includes('haste'));
  assert.ok(!keywords(s, faerie).includes('lifelink'));
  const artifact = put(s, 'Short Bow');
  assert.ok(keywords(s, goblin).includes('haste'));
  assert.equal(stats(s, goblin).power, 2);
  move(s, artifact, 'graveyard');
  assert.ok(!keywords(s, goblin).includes('haste'));
  const other = put(s, 'Barrow Naughty');
  assert.ok(keywords(s, faerie).includes('lifelink'));
  move(s, other, 'graveyard');
  assert.ok(!keywords(s, faerie).includes('lifelink'));
});
test('life thresholds add and remove double strike immediately', () => {
  const s = fixture(),
    paladin = put(s, 'Twinblade Paladin');
  assert.ok(!keywords(s, paladin).includes('double strike'));
  s.players[0].life = 25;
  assert.ok(keywords(s, paladin).includes('double strike'));
  s.players[0].life = 24;
  assert.ok(!keywords(s, paladin).includes('double strike'));
});
test('attacking bonuses remain during end of combat and end on entry to postcombat main', () => {
  const s = fixture(),
    corsair = put(s, 'Kitesail Corsair');
  s.step = 'damage';
  s.combat.attackers = [ref(corsair)];
  assert.ok(keywords(s, corsair).includes('flying'));
  advanceStep(s);
  assert.equal(s.step, 'endCombat');
  assert.ok(keywords(s, corsair).includes('flying'));
  advanceStep(s);
  assert.equal(s.step, 'main2');
  assert.ok(!keywords(s, corsair).includes('flying'));
});
test('conditional Equipment applies only during its controller turn', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  const knife = put(s, 'Knife'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: knife.id, ability: 1, target: ref(bear) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.ok(keywords(s, s.objects[bear.id]).includes('first strike'));
  nextTurn(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
  assert.ok(!keywords(s, s.objects[bear.id]).includes('first strike'));
});
test('entry-turn Aura protection ends on the next turn and resets on a fresh entry', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const bear = put(s, 'Grizzly Bears'),
    aura = put(s, "Shardmage's Rescue", 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  assert.ok(keywords(s, s.objects[bear.id]).includes('hexproof'));
  nextTurn(s);
  assert.ok(!keywords(s, s.objects[bear.id]).includes('hexproof'));
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
});
test('Descend counts permanent cards, never tokens temporarily in a graveyard', () => {
  const s = fixture(),
    capybara = put(s, 'Basking Capybara');
  for (let i = 0; i < 3; i++) put(s, 'Forest', 0, 'graveyard');
  put(s, 'Gremlin Token', 0, 'graveyard');
  const base = stats(s, capybara).power;
  put(s, 'Forest', 0, 'graveyard');
  assert.equal(stats(s, capybara).power, base + 3);
});
test('continuous predicates reject computed-keyword dependency cycles', () => {
  assert.throws(() =>
    createRegistry({
      ...CARDS,
      Bad: {
        name: 'Bad',
        type: 'creature',
        cost: {},
        power: 1,
        toughness: 1,
        conditionalBonuses: [
          {
            affects: 'self',
            condition: { kind: 'controlAtLeast', count: 1, where: { keyword: 'flying' } },
            power: 0,
            toughness: 0,
            keywords: ['flying'],
          },
        ],
      },
    }),
  );
});
