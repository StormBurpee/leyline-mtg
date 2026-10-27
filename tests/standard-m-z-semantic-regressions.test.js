import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS, createRegistry, ref } from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { move, notifyTriggers } from '../packages/engine/src/model.js';
import { stabilize } from '../packages/engine/src/effects.js';

const definitions = await Promise.all(
  ['wojek-investigator', 'stromkirk-bloodthief'].map(async (slug) => {
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    const compiled = compileCard(source, { identities: CARD_IDS });
    assert(compiled.ok, JSON.stringify(compiled.diagnostics));
    return [source.name, compiled.definition];
  }),
);
const vampireRelic = {
  name: 'Noncreature Vampire fixture',
  type: 'artifact',
  subtypes: ['Vampire'],
  cost: {},
};
function setup() {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    ...Object.fromEntries(definitions),
    [vampireRelic.name]: vampireRelic,
  });
  return s;
}
function upkeep(s) {
  s.step = 'upkeep';
  notifyTriggers(s, 'step', { player: 0, step: 'upkeep' });
  stabilize(s);
  return s;
}
const clues = (s) =>
  Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Clue Token');

// Oracle has no intervening "if" here (CR 603.4): compare hands on resolution only.
test('Wojek always triggers at upkeep and can investigate after hand counts change', () => {
  let s = setup();
  put(s, 'Wojek Investigator');
  upkeep(s);
  assert.equal(s.stack.length, 1, 'equal hand sizes must not suppress the trigger');
  put(s, 'Forest', 1, 'hand');
  s = resolve(s);
  assert.equal(clues(s).length, 1);
});
test('Wojek does not investigate when its opponent stops having more cards before resolution', () => {
  let s = setup();
  put(s, 'Wojek Investigator');
  const card = put(s, 'Forest', 1, 'hand');
  upkeep(s);
  assert.equal(s.stack.length, 1);
  move(s, card, 'graveyard');
  s = resolve(s);
  assert.equal(clues(s).length, 0);
});
test('Wojek investigates from its trigger even after leaving the battlefield', () => {
  let s = setup();
  const wojek = put(s, 'Wojek Investigator');
  upkeep(s);
  assert.equal(s.stack.length, 1);
  move(s, wojek, 'graveyard');
  put(s, 'Forest', 1, 'hand');
  s = resolve(s);
  assert.equal(clues(s).length, 1);
});
test('Wojek still resolves without investigating if hand sizes remain equal', () => {
  let s = setup();
  put(s, 'Wojek Investigator');
  upkeep(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(clues(s).length, 0);
});
test('Stromkirk can put its counter on a noncreature Vampire but not an opposing Vampire', () => {
  let s = setup();
  put(s, 'Stromkirk Bloodthief');
  const own = put(s, vampireRelic.name);
  const opposing = put(s, vampireRelic.name, 1);
  const nonVampire = put(s, 'Grizzly Bears');
  s.players[1].lifeLostTurn = s.turn;
  s.step = 'end';
  notifyTriggers(s, 'step', { player: 0, step: 'end' });
  stabilize(s);
  assert.equal(s.choice?.kind, 'triggerTarget');
  assert(s.choice.targets.some((target) => target.id === own.id));
  assert(!s.choice.targets.some((target) => target.id === opposing.id));
  assert(!s.choice.targets.some((target) => target.id === nonVampire.id));
  s = act(s, 'chooseTriggerTarget', { target: ref(own) });
  s = resolve(s);
  assert.equal(s.objects[own.id].plusCounters, 1);
});
