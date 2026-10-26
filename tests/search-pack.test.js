import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  dispatch,
  chooseBotCommand,
  assertInvariants,
} from '../packages/engine/src/index.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
const reviewed = JSON.parse(
  await readFile(new URL('./fixtures/search-reviewed-v020.json', import.meta.url)),
);
function ready() {
  const s = fixture();
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[color] = 30;
  for (const name of ['Forest', 'Plains', 'Solemn Simulacrum', 'Shock', 'Grizzly Bears'])
    put(s, name, 0, 'library');
  return s;
}
function settle(state) {
  for (let n = 0; n < 80 && (state.choice || state.stack.length || state.resolving); n++) {
    const p = state.choice?.player ?? state.priority;
    const command = state.choice ? chooseBotCommand(state, p) : { type: 'pass', player: p };
    assert.ok(command, `Unanswered choice ${state.choice?.kind}`);
    const result = dispatch(state, command);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    state = result.state;
  }
  assert.equal(state.choice, null);
  assert.equal(state.resolving, null);
  assert.equal(state.stack.length, 0);
  assertInvariants(state);
  return state;
}
for (const card of reviewed) {
  test(`${card.name}: reviewed search definition casts and resolves`, () => {
    assert.equal(CARD_IDS[card.oracle_id], card.name);
    let s = ready();
    const object = put(s, card.name, 0, 'hand');
    const d = CARDS[card.name];
    const result = dispatch(s, {
      type: d.type === 'land' ? 'playLand' : 'cast',
      player: 0,
      card: object.id,
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    s = settle(result.state);
    if (
      d.effects?.some((e) => e.op === 'searchLibrary') ||
      d.etb?.some((e) => e.op === 'searchLibrary') ||
      d.triggers?.some((t) => t.effects.some((e) => e.op === 'searchLibrary'))
    )
      assert.ok(
        s.events.some((e) => e.type === 'librarySearched'),
        card.name,
      );
  });
  for (let ability = 0; ability < (CARDS[card.name].activated?.length ?? 0); ability++) {
    test(`${card.name}: ability ${ability + 1} pays and completes`, () => {
      let s = ready();
      const object = put(s, card.name);
      const result = dispatch(s, { type: 'activate', player: 0, card: object.id, ability });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      s = settle(result.state);
      if (CARDS[card.name].activated[ability].effects.some((e) => e.op === 'searchLibrary'))
        assert.ok(s.events.some((e) => e.type === 'librarySearched'));
    });
  }
}
