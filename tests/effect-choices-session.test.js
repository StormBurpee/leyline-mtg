import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, chooseBotCommand, replay } from '../packages/engine/src/index.js';
import { createSession } from '../packages/simulation/session.js';

test('opaque session exposes offered alternatives, accepts bot command, and preserves deterministic replay', () => {
  const name = 'Opaque effect choice';
  const catalog = {
    ...CARDS,
    [name]: {
      name,
      type: 'sorcery',
      cost: {},
      effects: [
        {
          op: 'chooseEffect',
          options: [
            { label: 'Gain 2 life', effects: [{ op: 'gainLife', amount: 2 }] },
            { label: 'Gain 3 life', effects: [{ op: 'gainLife', amount: 3 }] },
          ],
        },
      ],
    },
  };
  const deck = [...Array(4).fill(name), ...Array(3).fill('Forest')];
  const session = createSession({
    catalog,
    decks: [deck, deck],
    minimumDeckSize: 7,
    mulligan: false,
  });
  const step = (command) => {
    const c = session.context();
    const r = session.step({ player: c.player, ...command });
    assert.equal(r.ok, true, JSON.stringify(r));
  };
  while (session.context().observation.step !== 'main1') step({ type: 'pass' });
  let c = session.context();
  step({
    type: 'cast',
    card: c.observation.players[0].hand.find((id) => c.observation.objects[id].name === name),
  });
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  assert.equal(c.observation.choice.kind, 'effectChoice');
  assert.deepEqual(
    c.actions.filter((a) => a.type === 'chooseEffect'),
    [
      { type: 'chooseEffect', option: 0, player: 0 },
      { type: 'chooseEffect', option: 1, player: 0 },
    ],
  );
  assert.equal(c.observation.players[1].hand, undefined);
  assert.equal(c.observation.players[0].library, undefined);
  assert.ok(Object.keys(c.observation.objects).every((id) => id.startsWith('object:')));
  const before = session.exportReplay();
  assert.equal(session.step({ type: 'chooseEffect', player: 0, option: 8 }).ok, false);
  assert.deepEqual(session.exportReplay(), before);
  const bot = chooseBotCommand(c.observation, c.player);
  assert.equal(bot.type, 'chooseEffect');
  step(bot);
  const restored = replay(session.exportReplay());
  assert.equal(restored.choice, null);
  assert.equal(restored.players[0].life, 22);
});
