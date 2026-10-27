import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  legalActions,
  chooseBotCommand,
  dispatch,
  exportReplay,
  replay,
  validateDefinition,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createSession } from '../packages/simulation/session.js';
import { activationSacrificePosition } from './helpers/activation-sacrifice-position.js';
test('selected activation cost schema, compiler and migration preserve exact selectors and quantity', async () => {
  const definition = activationSacrificePosition().catalog['Chosen Sacrificer'];
  const source = sourceFromDefinition(definition, { id: 'test:chosen-sacrificer' });
  const schema = JSON.parse(
    await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  const result = compileCard(source, { identities: { 'test:chosen-sacrificer': definition.name } });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition, definition);
  for (const sacrifice of [
    { count: 0 },
    { count: 11 },
    { count: 1, excludeSource: 'yes' },
    { count: 1, where: { unknown: true } },
    { count: 1, optional: true },
  ]) {
    const invalid = structuredClone(definition);
    invalid.activated[0].cost.sacrifice = sacrifice;
    assert.ok(validateDefinition(invalid).length);
  }
});
test('exact selected refs round-trip in replay and opaque agent commands; bot emits valid choice', () => {
  const s = activationSacrificePosition(),
    before = exportReplay(s);
  const a = legalActions(s, 0).find((a) => a.type === 'activate' && a.sacrifices);
  const result = dispatch(s, { ...a, player: 0 });
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(replay(exportReplay(result.state)), result.state);
  assert.equal(dispatch(s, chooseBotCommand(s, 0)).ok, true);
  const session = createSession(before.config);
  for (let i = 0; i < before.commands.length; i++) {
    const command = before.commands[i],
      old = replay({ ...before, commands: before.commands.slice(0, i) }),
      context = session.context();
    const proposal = context.actions.find(
      (a) =>
        a.type === command.type &&
        (!command.card ||
          context.observation.objects[a.card]?.name === old.objects[command.card].name),
    );
    assert.ok(proposal, command.type);
    assert.equal(session.step(proposal).ok, true);
  }
  const context = session.context(),
    action = context.actions.find((a) => a.type === 'activate' && a.sacrifices);
  assert.ok(action);
  assert.match(action.sacrifices[0].id, /^object:/);
  assert.equal(session.step(action).ok, true);
});
