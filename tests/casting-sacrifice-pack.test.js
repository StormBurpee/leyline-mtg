import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  CARD_IDS,
  legalActions,
  chooseBotCommand,
  dispatch,
  exportReplay,
  replay,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createSession } from '../packages/simulation/session.js';
import { castingSacrificePosition } from './helpers/casting-sacrifice-position.js';
const names = [
  'Arbiter of Woe',
  'Corrupted Conviction',
  'Duty Beyond Death',
  'Embrace Oblivion',
  'Final Vengeance',
  'Vile Mutilator',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
test('six complete mandatory-sacrifice sources validate, compile, and round trip all Oracle clauses', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    const result = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, CARDS[name]);
    const round = compileCard(
      sourceFromDefinition(result.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, result.definition);
  }
});
test('explicit sacrifice references persist through replay and opaque proposals, and bots submit valid costs', () => {
  const s = castingSacrificePosition(),
    before = exportReplay(s);
  const action = legalActions(s, 0).find((a) => a.type === 'cast' && a.sacrifice);
  const r = dispatch(s, { ...action, player: 0 });
  assert.equal(r.ok, true, r.error?.message);
  const restored = replay(exportReplay(r.state));
  assert.deepEqual(restored, r.state);
  assert.equal(dispatch(s, chooseBotCommand(s, 0)).ok, true);
  const session = createSession(before.config);
  for (let i = 0; i < before.commands.length; i++) {
    const command = before.commands[i],
      ctx = session.context();
    const old = replay({ ...before, commands: before.commands.slice(0, i) });
    const proposal =
      (command.type === 'attackers' ? command : null) ??
      ctx.actions.find(
        (a) =>
          a.type === command.type &&
          (!command.card ||
            ctx.observation.objects[a.card]?.name === old.objects[command.card].name),
      );
    assert.ok(proposal, command.type);
    assert.equal(session.step(proposal).ok, true);
  }
  const ctx = session.context(),
    proposal = ctx.actions.find((a) => a.type === 'cast' && a.sacrifice);
  assert.match(proposal.sacrifice.id, /^object:/);
  assert.equal(session.step(proposal).ok, true);
});
