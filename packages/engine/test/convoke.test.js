import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  castProblem,
  legalActions,
  castingProfile,
  convokePayment,
  keywords,
  stats,
  ref,
} from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const pick = (o, symbol = 'generic') => ({ card: o.id, symbol });
function custom(s, name, cost, extra = {}) {
  s.catalog = createRegistry({
    ...CARDS,
    [name]: {
      name,
      type: 'instant',
      cost,
      color: ['U'],
      keywords: ['convoke'],
      effects: [],
      ...extra,
    },
  });
  return put(s, name, 0, 'hand');
}
test('summoning-sick creatures pay exact generic, colored and hybrid components', () => {
  let s = fixture();
  const spell = put(s, 'Merrow Skyswimmer', 0, 'hand');
  const creatures = [
    'Savannah Lions',
    'Aegis Turtle',
    'Grizzly Bears',
    'Grizzly Bears',
    'Grizzly Bears',
  ].map((name) => put(s, name, 0, 'battlefield', { ready: false }));
  const convoke = creatures.map((o, i) => pick(o, i < 2 ? 'W/U' : 'generic'));
  assert.equal(castProblem(s, 0, spell.id, null, { convoke }), null);
  s = act(s, 'cast', { card: spell.id, convoke });
  assert.deepEqual(s.stack.at(-1).castingCost, { generic: 3, 'W/U': 2 });
  assert.deepEqual(s.stack.at(-1).convoke, convoke);
  assert.ok(creatures.every((o) => s.objects[o.id].tapped));
  s = resolve(s);
  s = resolve(s);
  assert.ok(
    Object.values(s.objects).some(
      (o) => o.name === 'White and Blue Merfolk Token' && o.zone === 'battlefield',
    ),
  );
});
test('explicit convoke validation rejects overpayment, duplicates, wrong colors and stale choices atomically', () => {
  const s = fixture(),
    spell = custom(s, 'Test Convoke', { U: 1, generic: 1 }),
    blue = put(s, 'Aegis Turtle'),
    green = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Aegis Turtle', 1),
    tapped = put(s, 'Aegis Turtle');
  tapped.tapped = true;
  const before = structuredClone(s);
  for (const convoke of [
    null,
    {},
    [pick(blue), pick(blue, 'U')],
    [pick(green, 'U')],
    [pick(enemy, 'U')],
    [pick(tapped, 'U')],
    [pick(blue, 'C')],
    [pick(blue, 'X')],
    [pick(blue, 'U'), pick(green), pick(enemy)],
    [{ card: blue.id, symbol: 'U', extra: 1 }],
  ]) {
    const result = dispatch(s, { type: 'cast', player: 0, card: spell.id, convoke });
    assert.equal(result.ok, false, JSON.stringify(convoke));
    assert.deepEqual(s, before);
  }
});
test('one creature cannot both generate mana and convoke; sickness does not prevent convoke', () => {
  const s = fixture(),
    spell = custom(s, 'Test Convoke', { generic: 2 }),
    elf = put(s, 'Llanowar Elves');
  assert.ok(castProblem(s, 0, spell.id));
  assert.ok(castProblem(s, 0, spell.id, null, { convoke: [pick(elf)] }));
  const second = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false });
  assert.equal(castProblem(s, 0, spell.id), null);
  const next = act(s, 'cast', { card: spell.id });
  assert.equal(next.objects[elf.id].tapped, true);
  assert.equal(next.objects[second.id].tapped, true);
});
test('manual assignments beyond automatic witness are legal and no-autoTap preserves mana sources', () => {
  const s = fixture(),
    spell = custom(s, 'Test Convoke', { U: 1, generic: 1 }),
    first = put(s, 'Aegis Turtle'),
    second = put(s, 'Aegis Turtle'),
    third = put(s, 'Grizzly Bears');
  lands(s, 'Island', 3);
  const convoke = [pick(second, 'U'), pick(third)];
  assert.equal(castProblem(s, 0, spell.id, null, { convoke, autoTap: false }), null);
  const next = act(s, 'cast', { card: spell.id, convoke, autoTap: false });
  assert.equal(next.objects[first.id].tapped, false);
  assert.ok(
    Object.values(next.objects)
      .filter((o) => o.name === 'Island' && o.zone === 'battlefield')
      .every((o) => !o.tapped),
  );
  assert.equal(
    legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === spell.id).length,
    1,
  );
});
test('X and cost changes are determined before convoke, locked, and cannot be overpaid', () => {
  let s = fixture();
  const spell = custom(
    s,
    'Test Convoke',
    { X: 1, U: 1 },
    { costModifiers: [{ scope: 'self', change: 'reduce', amount: 2 }] },
  );
  const creatures = [put(s, 'Aegis Turtle'), put(s, 'Grizzly Bears')];
  const convoke = [pick(creatures[0], 'U'), pick(creatures[1])];
  assert.equal(castProblem(s, 0, spell.id, null, { x: 3, convoke }), null);
  assert.ok(castProblem(s, 0, spell.id, null, { x: 0, convoke }));
  s = act(s, 'cast', { card: spell.id, x: 3, convoke });
  assert.deepEqual(s.stack.at(-1).castingCost, { U: 1, generic: 1 });
  assert.equal(s.stack.at(-1).x, 3);
});
test('convoke never pays colorless and respects ordinary priority, targets and spell timing', () => {
  const s = fixture(),
    spell = custom(s, 'Test Convoke', { C: 1 }),
    blue = put(s, 'Aegis Turtle');
  assert.ok(castProblem(s, 0, spell.id));
  assert.equal(convokePayment(s, 0, castingProfile(s, 0, spell), [pick(blue, 'C')]), null);
  const vote = put(s, 'Vote Out', 0, 'hand');
  lands(s, 'Swamp', 4);
  assert.ok(castProblem(s, 0, vote.id));
  assert.equal(castProblem(s, 0, vote.id, ref(blue)), null);
  s.step = 'upkeep';
  assert.ok(castProblem(s, 0, vote.id, ref(blue)));
});
test('flashback plus convoke preserves exile replacement and fixed-cost restrictions', () => {
  let s = fixture();
  const spell = custom(s, 'Test Convoke', { U: 1 }, { flashback: { U: 1 } }),
    blue = put(s, 'Aegis Turtle');
  s.players[0].hand = s.players[0].hand.filter((id) => id !== spell.id);
  spell.zone = 'graveyard';
  s.players[0].graveyard.push(spell.id);
  s = act(s, 'cast', { card: spell.id, convoke: [pick(blue, 'U')] });
  assert.equal(s.stack.at(-1).flashbackPaid, true);
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'exile');
  assert.throws(() =>
    createRegistry({
      ...CARDS,
      Bad: {
        name: 'Bad',
        type: 'instant',
        cost: { X: 1 },
        flashback: { U: 1 },
        keywords: ['convoke'],
        effects: [],
      },
    }),
  );
});
test('Rescuer grants only other tapped creatures hexproof; Winter buffs all your creatures on noncreature casts', () => {
  let s = fixture();
  const rescuer = put(s, 'The Wandering Rescuer'),
    bear = put(s, 'Grizzly Bears');
  bear.tapped = true;
  rescuer.tapped = true;
  assert.ok(keywords(s, bear).includes('hexproof'));
  assert.ok(!keywords(s, rescuer).includes('hexproof'));
  put(s, 'Winter, Team Player');
  const spell = put(s, 'Opt', 0, 'hand');
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
});
test('automatic matching handles flexible colors and hybrids without consuming a creature twice', () => {
  const s = fixture(),
    spell = custom(s, 'Test Convoke', { 'W/U': 1, U: 1 }),
    dual = put(s, 'White and Blue Merfolk Token'),
    blue = put(s, 'Aegis Turtle');
  const plan = convokePayment(s, 0, castingProfile(s, 0, spell));
  assert.ok(plan);
  assert.equal(new Set(plan.choices.map((c) => c.card)).size, 2);
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: spell.id }).ok, true);
});
test('zero total cost cannot convoke, taxes are paid before reductions, and colorless creatures pay generic only', () => {
  const s = fixture(),
    spell = custom(
      s,
      'Test Convoke',
      {},
      {
        costModifiers: [
          { scope: 'self', change: 'increase', amount: 2 },
          { scope: 'self', change: 'reduce', amount: 1 },
        ],
      },
    ),
    token = put(s, 'Wall Token');
  assert.equal(castProblem(s, 0, spell.id, null, { convoke: [pick(token)] }), null);
  const profile = { ...castingProfile(s, 0, spell), cost: {} };
  assert.equal(convokePayment(s, 0, profile, [pick(token)]), null);
  assert.ok(convokePayment(s, 0, profile, []));
  assert.equal(convokePayment(s, 0, { ...profile, cost: { U: 1 } }, [pick(token, 'U')]), null);
});
