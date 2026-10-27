import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  createGame,
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
import { bargainPosition } from './helpers/bargain-position.js';
const names = [
  "Agatha's Champion",
  "Archon's Glory",
  'Candy Grapple',
  'Farsight Ritual',
  'Hamlet Glutton',
  'High Fae Negotiator',
  'Ice Out',
  "Johann's Stopgap",
  "Kellan's Lightblades",
  'Realm-Scorcher Hellkite',
  'Stonesplitter Bolt',
  'Tenacious Tomeseeker',
  'Troublemaker Ouphe',
];
test('thirteen complete bargain sources validate, compile and round trip without rules-level modal abilities', async () => {
  const schema = JSON.parse(
      await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
    ),
    validate = new Ajv2020({ strict: true }).compile(schema),
    mechanics = JSON.parse(
      await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
    ),
    idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      source = JSON.parse(
        await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
      );
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    const r = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
    assert.deepEqual(r.definition, CARDS[name]);
    assert.equal(r.definition.bargain, true);
    assert.equal(r.definition.modes, undefined);
    const round = compileCard(sourceFromDefinition(r.definition, { id: source.id, idsByName }), {
      identities: CARD_IDS,
      mechanics,
    });
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, r.definition);
  }
});
test('bargained payment, entry state and opaque proposals survive deterministic replay', () => {
  const s = bargainPosition(),
    before = exportReplay(s),
    action = legalActions(s, 0).find((a) => a.type === 'cast' && a.mode === 1 && a.sacrifice);
  let r = dispatch(s, { ...action, player: 0 });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.state.stack.at(-1).bargained, true);
  assert.deepEqual(replay(exportReplay(r.state)), r.state);
  for (let i = 0; i < 6; i++) {
    const p = r.state.choice?.player ?? r.state.priority;
    r = dispatch(r.state, chooseBotCommand(r.state, p));
    assert.equal(r.ok, true, r.error?.message);
    assert.deepEqual(replay(exportReplay(r.state)), r.state);
  }
  const session = createSession(before.config);
  let old = createGame(before.config);
  for (let i = 0; i < before.commands.length; i++) {
    const command = before.commands[i],
      ctx = session.context();
    const proposal =
      command.type === 'orderLibrary'
        ? {
            ...command,
            top: command.top.map(
              (id) => ctx.observation.choice.cards[old.choice.cards.indexOf(id)],
            ),
            rest: command.rest.map(
              (id) => ctx.observation.choice.cards[old.choice.cards.indexOf(id)],
            ),
          }
        : command.type === 'attackers'
          ? command
          : ctx.actions.find(
              (a) =>
                a.type === command.type &&
                (!command.card ||
                  ctx.observation.objects[a.card]?.name === old.objects[command.card].name),
            );
    assert.ok(proposal, command.type);
    assert.equal(session.step(proposal).ok, true);
    const next = dispatch(old, command);
    assert.equal(next.ok, true);
    old = next.state;
  }
  const ctx = session.context(),
    proposal = ctx.actions.find((a) => a.type === 'cast' && a.mode === 1 && a.sacrifice);
  assert.match(proposal.sacrifice.id, /^object:/);
  assert.equal(session.step(proposal).ok, true);
});
