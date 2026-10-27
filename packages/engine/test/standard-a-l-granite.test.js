import { move } from '../src/model.js';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords, legalActions, dispatch } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = ['Granite Witness'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('Granite Witness roundtrips exactly', () => {
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

function faceUp(tapped = false) {
  let s = rich();
  const witness = put(s, 'Granite Witness'),
    target = put(s, 'Grizzly Bears');
  witness.faceDown = true;
  target.tapped = tapped;
  s = act(s, 'turnFaceUp', { card: witness.id });
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 1);
  return { s, witness, target };
}
for (const tapped of [false, true])
  test(`Witness presents only legal tap/untap plus decline at resolution (${tapped})`, () => {
    let { s, target } = faceUp(tapped);
    s = resolve(s);
    assert.equal(s.choice.kind, 'effectChoice');
    const options = legalActions(s, 0)
      .filter((a) => a.type === 'chooseEffect')
      .map((a) => a.option);
    assert.deepEqual(options, [tapped ? 1 : 0, 2]);
    s = act(s, 'chooseEffect', { option: tapped ? 1 : 0 });
    assert.equal(s.objects[target.id].tapped, !tapped);
  });
test('Witness may decline and target state is checked at resolution, not trigger announcement', () => {
  let { s, target } = faceUp(false);
  s.objects[target.id].tapped = true;
  s = resolve(s);
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.type === 'chooseEffect')
      .map((a) => a.option),
    [1, 2],
  );
  s = act(s, 'chooseEffect', { option: 2 });
  assert.equal(s.objects[target.id].tapped, true);
});
test('Witness choice controller and target remain bound after source changes control or leaves', () => {
  let { s, witness, target } = faceUp(false);
  s.objects[witness.id].controller = 1;
  move(s, s.objects[witness.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.player, 0);
  assert.equal(dispatch(s, { type: 'chooseEffect', player: 1, option: 0 }).ok, false);
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.objects[target.id].tapped, true);
});
test('Witness does not offer a choice or affect a new incarnation when target leaves and returns', () => {
  let { s, target } = faceUp(false);
  move(s, s.objects[target.id], 'exile');
  enterBattlefield(s, s.objects[target.id], 0);
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.objects[target.id].tapped, false);
});
