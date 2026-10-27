import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, CARD_IDS, createRegistry, hasKeyword } from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { fixture as baseFixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { move, ref, definition } from '../packages/engine/src/model.js';
import { numericValue } from '../packages/engine/src/numeric-values.js';
import { canAttack } from '../packages/engine/src/combat.js';

const names = [
  'Daring Discovery',
  'Beastie Beatdown',
  'Manifold Mouse',
  'Keen Buccaneer',
  'Patchwork Beastie',
];
const definitions = Object.fromEntries(
  names.map((name) => {
    const source = JSON.parse(
      readFileSync(
        new URL(
          `../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
          import.meta.url,
        ),
      ),
    );
    const compiled = compileCard(source, { identities: CARD_IDS });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    return [name, compiled.definition];
  }),
);
const catalog = createRegistry({ ...CARDS, ...definitions });
function fixture() {
  const s = baseFixture();
  s.catalog = catalog;
  for (const p of s.players) for (const id of [...p.library]) move(s, s.objects[id], 'exile');
  return s;
}
const graveyardTypes = (s, player = 0) =>
  numericValue(s, { kind: 'graveyardCardTypes', player: 'you' }, { controller: player });
function discover(s) {
  const parent = put(s, 'Daring Discovery', 0, 'hand');
  s.players[0].mana.R = 5;
  s = resolve(act(s, 'cast', { card: parent.id, targets: { creatures: [] } }));
  assert.equal(s.choice.kind, 'castExiled');
  return { s, parent };
}

test('a Discover parent reaches the graveyard before its discovered Delirium spell resolves', () => {
  let s = fixture();
  put(s, 'Ornithopter', 0, 'graveyard');
  put(s, 'Forest', 0, 'graveyard');
  const actor = put(s, 'Grizzly Bears'),
    victim = put(s, 'Serra Angel', 1);
  const beatdown = put(s, 'Beastie Beatdown', 0, 'library');
  assert.equal(graveyardTypes(s), 3);
  const begun = discover(s);
  s = begun.s;
  assert.equal(graveyardTypes(s), 3, 'the resolving parent is still on the stack');
  s = act(s, 'cast', {
    card: beatdown.id,
    targets: { actor: [ref(actor)], victim: [ref(victim)] },
  });
  assert.equal(s.objects[begun.parent.id].zone, 'graveyard');
  assert.equal(s.objects[beatdown.id].zone, 'stack');
  assert.equal(s.stack.at(-1).manaSpent, 0);
  assert.equal(graveyardTypes(s), 4, 'the completed parent now supplies sorcery');
  s = resolve(s);
  assert.equal(s.objects[actor.id].plusCounters, 2);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});

test('Discover keeps Manifold Mouse offspring as a paid additional cost and copies the resolving-choice trigger', () => {
  let s = fixture();
  const mouse = put(s, 'Manifold Mouse', 0, 'library');
  s = discover(s).s;
  s.players[0].mana.C = 2;
  s = act(s, 'cast', { card: mouse.id, mode: 1 });
  assert.equal(s.stack.at(-1).manaSpent, 2);
  s = resolve(s);
  assert.equal(s.stack.length, 1, 'offspring trigger waits for the discovered creature to resolve');
  s = resolve(s);
  const copy = Object.values(s.objects).find((o) => o.token && o.name === 'Manifold Mouse');
  assert.ok(copy);
  assert.equal(definition(s, copy).power, 1);
  assert.equal(definition(s, copy).toughness, 1);
  assert.equal(definition(s, copy).triggers[0].effects[0].op, 'chooseEffect');
  assert.equal(hasKeyword(s, copy, 'double strike'), false);
});

test('Exhaust discard updates live Delirium while its choice retains the activating controller', () => {
  let s = fixture();
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Shock', 0, 'graveyard');
  const beastie = put(s, 'Patchwork Beastie'),
    keen = put(s, 'Keen Buccaneer');
  const drawn = put(s, 'Ornithopter', 0, 'library');
  s.players[0].mana.U = 2;
  assert.equal(canAttack(s, beastie, 0), false);
  s = act(s, 'activate', { card: keen.id, ability: 0 });
  s.objects[keen.id].controller = 1;
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.player, 0);
  assert.equal(s.objects[drawn.id].zone, 'hand');
  assert.equal(graveyardTypes(s), 2);
  assert.equal(s.objects[keen.id].plusCounters, 0);
  s = act(s, 'discardEffect', { cards: [drawn.id] });
  assert.equal(graveyardTypes(s), 4);
  assert.equal(canAttack(s, s.objects[beastie.id], 0), true);
  assert.equal(s.objects[keen.id].controller, 1);
  assert.equal(s.objects[keen.id].plusCounters, 1);
  assert.equal(s.objects[keen.id].exhaustUses[0], s.objects[keen.id].incarnation);
});
