import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  legalActions,
  dispatch,
  chooseBotCommand,
  assertInvariants,
  ref,
  targetSpec,
} from '../packages/engine/src/index.js';
import { fixture, put, act } from '../packages/engine/test/helpers.js';
const rows = JSON.parse(
  await readFile(new URL('./fixtures/modal-reviewed-v023.json', import.meta.url), 'utf8'),
);
for (const row of rows)
  for (let mode = 0; mode < CARDS[row.name].modes.length; mode++)
    test(`${row.name}: mode ${mode + 1} has its own legal cast and completes`, () => {
      assert.equal(CARD_IDS[row.oracle_id], row.name);
      let s = fixture();
      for (const p of s.players) for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[c] = 40;
      put(s, 'Grizzly Bears');
      put(s, 'Isamaru, Hound of Konda');
      put(s, 'Forest').tapped = true;
      for (const n of [
        'Serra Angel',
        'Resolute Watchdog',
        'Vampire Nighthawk',
        'Expedition Map',
        'Glorious Anthem',
      ])
        put(s, n, 1).tapped = true;
      put(s, 'Grizzly Bears', 0, 'graveyard');
      put(s, 'Promising Vein', 0, 'graveyard');
      put(s, 'Shock', 1, 'graveyard');
      put(s, 'Forest', 0, 'library');
      const card = put(s, row.name, 0, 'hand');
      if (targetSpec(CARDS[row.name].modes[mode].target)?.scope === 'spell') {
        const shock = put(s, 'Shock', 1, 'hand');
        s.priority = 1;
        s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 0 } }, 1);
        s = act(s, 'pass', {}, 1);
      }
      if (row.name === 'Raze the Effigy' && mode === 1) {
        s.step = 'attackers';
        s.choice = { kind: 'attackers', player: 0 };
        s = act(s, 'attackers', {
          cards: [
            Object.values(s.objects).find(
              (o) => o.zone === 'battlefield' && o.controller === 0 && o.name === 'Grizzly Bears',
            ).id,
          ],
        });
      }
      const command = legalActions(s, 0).find(
        (a) => a.type === 'cast' && a.card === card.id && a.mode === mode,
      );
      assert.ok(command, `${row.name} mode ${mode} has no matching setup target`);
      let r = dispatch(s, { ...command, player: 0 });
      assert.equal(r.ok, true, JSON.stringify(r.error));
      s = r.state;
      assert.equal(s.stack.at(-1).mode, mode);
      for (let i = 0; i < 100 && (s.choice || s.stack.length || s.resolving); i++) {
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
