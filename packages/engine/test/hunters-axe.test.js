import { move } from '../src/model.js';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords, dispatch } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = ["Hunter's Axe"];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('Hunter Axe source roundtrips exactly', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});

function equipped() {
  let s = rich();
  const axe = put(s, names[0]),
    bear = put(s, 'Grizzly Bears'),
    other = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: axe.id, ability: 0, target: ref(bear) }));
  return { s, axe, bear, other };
}
function attack(s, bear, player = 0) {
  s.active = player;
  s.priority = player;
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player };
  return act(s, 'attackers', { cards: [bear.id] }, player);
}
for (const option of [0, 1])
  test(`Axe grants +2/+0 and wearer chooses keyword ${option} on resolution`, () => {
    let { s, axe, bear } = equipped();
    assert.equal(stats(s, s.objects[bear.id]).power, 4);
    s = attack(s, bear);
    assert.equal(s.stack.length, 1);
    assert.equal(s.stack[0].source.id, bear.id);
    assert.equal(s.stack[0].controller, 0);
    assert.equal(s.choice, null);
    s = resolve(s);
    assert.equal(s.choice.kind, 'effectChoice');
    s = act(s, 'chooseEffect', { option });
    assert.ok(keywords(s, s.objects[bear.id]).includes(option ? 'deathtouch' : 'trample'));
    assert.equal(keywords(s, s.objects[axe.id]).includes(option ? 'deathtouch' : 'trample'), false);
  });
test('Bearer controller, not Equipment controller, owns the trigger and choice after control changes', () => {
  let { s, axe, bear } = equipped();
  s.objects[bear.id].controller = 1;
  s = attack(s, bear, 1);
  assert.equal(s.stack[0].controller, 1);
  assert.equal(s.stack[0].source.id, bear.id);
  s.objects[bear.id].controller = 0;
  s.objects[axe.id].controller = 1;
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  assert.equal(dispatch(s, { type: 'chooseEffect', player: 0, option: 0 }).ok, false);
  s = act(s, 'chooseEffect', { option: 0 }, 1);
  assert.ok(keywords(s, s.objects[bear.id]).includes('trample'));
});
for (const detach of ['destroy', 'reattach'])
  test(`Queued creature trigger survives Equipment ${detach} without changing its source`, () => {
    let { s, axe, bear, other } = equipped();
    s = attack(s, bear);
    if (detach === 'destroy') move(s, s.objects[axe.id], 'graveyard');
    else s.objects[axe.id].attachedTo = ref(s.objects[other.id]);
    s = resolve(s);
    s = act(s, 'chooseEffect', { option: 1 });
    assert.ok(keywords(s, s.objects[bear.id]).includes('deathtouch'));
    assert.equal(keywords(s, s.objects[other.id]).includes('deathtouch'), false);
    assert.equal(stats(s, s.objects[bear.id]).power, 2);
  });
test('Reequipping before an attack gives the trigger only to the current bearer', () => {
  let { s, axe, bear, other } = equipped();
  s = resolve(act(s, 'activate', { card: axe.id, ability: 0, target: ref(other) }));
  s = attack(s, bear);
  assert.equal(s.stack.length, 0);
});
test('A blinked bearer cannot receive a keyword through the old trigger incarnation', () => {
  let { s, bear } = equipped();
  s = attack(s, bear);
  const original = s.stack[0].source.incarnation;
  move(s, s.objects[bear.id], 'exile');
  enterBattlefield(s, s.objects[bear.id], 0);
  assert.notEqual(s.objects[bear.id].incarnation, original);
  s = resolve(s);
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(keywords(s, s.objects[bear.id]).includes('trample'), false);
});
