import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  stats,
  keywords,
  ref,
  playerView,
  validateDefinition,
} from '../src/index.js';
import { move, copiableDefinition } from '../src/model.js';
import { resolveEffects } from '../src/effects.js';
import { cleanup } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

// CR 613.1f–g and 613.4c: complete layer 6 before evaluating layer-7c P/T filters.
// https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt
const eagle = 'Empyrean Eagle';
const legacy = 'Air Nomad Legacy';
const size = (s, o, power, toughness) => assert.deepEqual(stats(s, o), { power, toughness });
test('flying anthem excludes its source and opponent; multiple sources stack without recursion', () => {
  const s = fixture();
  const a = put(s, eagle),
    b = put(s, eagle),
    hawk = put(s, "Healer's Hawk");
  const enemy = put(s, "Healer's Hawk", 1),
    bear = put(s, 'Grizzly Bears');
  size(s, a, 3, 4);
  size(s, b, 3, 4);
  size(s, hawk, 3, 3);
  size(s, enemy, 1, 1);
  size(s, bear, 2, 2);
  for (let i = 0; i < 100; i++) {
    size(s, hawk, 3, 3);
    assert.ok(keywords(s, a).includes('flying'));
  }
  move(s, a, 'graveyard');
  size(s, b, 2, 3);
  size(s, hawk, 2, 2);
  move(s, b, 'graveyard');
  size(s, hawk, 1, 1);
});
test('temporary flying grants qualify immediately and expire at cleanup', () => {
  let s = fixture();
  put(s, eagle);
  lands(s, 'Plains', 1);
  const bear = put(s, 'Grizzly Bears'),
    leap = put(s, 'Acrobatic Leap', 0, 'hand');
  s = act(s, 'cast', { card: leap.id, target: ref(bear) });
  s = resolve(s);
  size(s, s.objects[bear.id], 4, 6);
  assert.ok(keywords(s, s.objects[bear.id]).includes('flying'));
  cleanup(s);
  size(s, s.objects[bear.id], 2, 2);
  assert.ok(!keywords(s, s.objects[bear.id]).includes('flying'));
});
test('unconditional ability anthems feed P/T anthems; removal, copies and face-down values recompute', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Flying grant': {
      name: 'Flying grant',
      type: 'enchantment',
      cost: {},
      static: { kind: 'anthem', power: 0, toughness: 0, keywords: ['flying'] },
    },
    'Flying equipment': {
      name: 'Flying equipment',
      type: 'artifact',
      subtypes: ['Equipment'],
      cost: {},
      attachmentBonus: { power: 0, toughness: 0, keywords: ['flying'] },
    },
  });
  put(s, eagle);
  const grant = put(s, 'Flying grant'),
    bear = put(s, 'Grizzly Bears');
  size(s, bear, 3, 3);
  move(s, grant, 'graveyard');
  size(s, bear, 2, 2);
  const equipment = put(s, 'Flying equipment');
  equipment.attachedTo = ref(bear);
  size(s, bear, 3, 3);
  delete equipment.attachedTo;
  size(s, bear, 2, 2);
  bear.definitionOverride = copiableDefinition(s, put(s, "Healer's Hawk"));
  size(s, bear, 2, 2);
  assert.ok(keywords(s, bear).includes('flying'));
  bear.faceDown = true;
  size(s, bear, 2, 2);
  assert.ok(!keywords(s, bear).includes('flying'));
  delete bear.faceDown;
  size(s, bear, 2, 2);
  // A copy of a nonflier does not inherit an external ability grant.
  const grounded = put(s, 'Grizzly Bears');
  resolveEffects(s, {
    controller: 0,
    target: ref(grounded),
    effects: [
      {
        op: 'modify',
        target: 'target',
        power: 0,
        toughness: 0,
        keywords: ['flying'],
        until: 'endOfTurn',
      },
    ],
  });
  bear.definitionOverride = copiableDefinition(s, grounded);
  size(s, grounded, 3, 3);
  size(s, bear, 2, 2);
});
test('Air Nomad Legacy creates exactly one Clue on entry and buffs flying creatures only', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  lands(s, 'Island', 1);
  const card = put(s, legacy, 0, 'hand'),
    hawk = put(s, "Healer's Hawk");
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.token && o.name === 'Clue Token',
    ).length,
    1,
  );
  size(s, s.objects[hawk.id], 2, 2);
  const hidden = put(s, eagle, 1, 'hand');
  const view = playerView(s, 0);
  assert.equal(view.objects[hidden.id], undefined);
  size(view, view.objects[hawk.id], 2, 2);
});
test('authoring permits keyword predicates only for P/T-only static effects, including nested predicates', () => {
  const d = CARDS[eagle];
  for (const where of [
    { keyword: 'flying' },
    { not: { keyword: 'flying' } },
    { any: [{ keyword: 'flying' }, { type: 'artifact' }] },
  ]) {
    assert.deepEqual(validateDefinition({ ...d, static: { ...d.static, where } }), []);
    assert.ok(
      validateDefinition({ ...d, static: { ...d.static, where, keywords: ['vigilance'] } }).length,
    );
  }
  for (const where of [{ power: { gte: 2 } }, { not: { toughness: { lte: 3 } } }])
    assert.ok(
      validateDefinition({ ...d, static: { ...d.static, where } }).some((message) =>
        message.includes('future layer evaluator'),
      ),
    );
});

test('nested negative keyword filters use granted abilities rather than printed keywords', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Grounded bonus': {
      name: 'Grounded bonus',
      type: 'enchantment',
      cost: {},
      static: {
        kind: 'anthem',
        power: 1,
        toughness: 1,
        keywords: [],
        where: {
          all: [{ controller: 'you' }, { type: 'creature' }, { not: { keyword: 'flying' } }],
        },
      },
    },
  });
  put(s, 'Grounded bonus');
  const bear = put(s, 'Grizzly Bears');
  size(s, bear, 3, 3);
  resolveEffects(s, {
    controller: 0,
    target: ref(bear),
    effects: [
      {
        op: 'modify',
        target: 'target',
        power: 0,
        toughness: 0,
        keywords: ['flying'],
        until: 'endOfTurn',
      },
    ],
  });
  size(s, bear, 2, 2);
});
