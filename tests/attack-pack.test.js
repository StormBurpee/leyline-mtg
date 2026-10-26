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
const rows = JSON.parse(
  await readFile(new URL('./fixtures/attack-reviewed-v022.json', import.meta.url), 'utf8'),
);
for (const row of rows)
  test(`${row.name}: reviewed attack trigger executes through public choices`, () => {
    assert.equal(CARD_IDS[row.oracle_id], row.name);
    assert.ok(row.released_at <= '2026-10-26');
    let s = fixture();
    const card = put(s, row.name);
    put(s, 'Grizzly Bears', 1);
    put(s, 'Isamaru, Hound of Konda');
    put(s, 'Forest');
    s.step = 'attackers';
    s.choice = { kind: 'attackers', player: 0 };
    let r = dispatch(s, { type: 'attackers', player: 0, cards: [card.id] });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    s = r.state;
    assert.ok(s.events.some((e) => e.type === 'triggered' && e.objectId === card.id));
    for (let n = 0; n < 40 && (s.choice || s.stack.length || s.resolving); n++) {
      const player = s.choice?.player ?? s.priority,
        cmd = s.choice ? chooseBotCommand(s, player) : { type: 'pass', player };
      r = dispatch(s, cmd);
      assert.equal(r.ok, true, JSON.stringify(r.error));
      s = r.state;
    }
    assert.equal(s.choice, null);
    assert.equal(s.stack.length, 0);
    assert.equal(s.resolving, null);
    assertInvariants(s);
  });
