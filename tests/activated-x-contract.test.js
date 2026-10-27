import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import {
  legalActions,
  dispatch,
  exportReplay,
  replay,
  validateDefinition,
} from '../packages/engine/src/index.js';
import { createSession } from '../packages/simulation/session.js';
import { activatedXPosition } from './helpers/activated-x-position.js';
import { mount } from './helpers/client-mount.js';

test('activated X schema/compiler/native roundtrip and unsupported contexts fail closed', () => {
  const d = activatedXPosition().catalog['Chosen Sacrificer'];
  const source = sourceFromDefinition(d, { id: 'test:activated-x' });
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url))),
  );
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition, d);
  for (const change of [
    (a) => (a.cost.mana = { U: 1 }),
    (a) => (a.cost.life = { kind: 'x' }),
    (a) => (a.condition = { kind: 'compare', left: { kind: 'x' }, right: 1, operator: 'gt' }),
    (a) =>
      (a.effects = [
        {
          op: 'conditional',
          condition: { kind: 'compare', left: { kind: 'x' }, right: 1, operator: 'gt' },
          then: [{ op: 'draw', count: 1 }],
        },
      ]),
    (a) => {
      delete a.cost.sacrifice;
      a.effects = [{ op: 'addMana', mana: { U: 1 } }];
    },
  ]) {
    const invalid = structuredClone(d);
    change(invalid.activated[0]);
    assert.ok(validateDefinition(invalid).length);
    assert.equal(compileCard(sourceFromDefinition(invalid, { id: 'test:invalid-x' })).ok, false);
  }
});
test('activated X survives deterministic replay and opaque public proposals including selected-cost refs', () => {
  const s = activatedXPosition(),
    record = exportReplay(s);
  const action = legalActions(s, 0).find((a) => a.type === 'activate' && a.x === 1);
  const result = dispatch(s, { ...action, player: 0 });
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(replay(exportReplay(result.state)), result.state);
  const session = createSession(record.config);
  for (let i = 0; i < record.commands.length; i++) {
    const command = record.commands[i],
      previous = replay({ ...record, commands: record.commands.slice(0, i) }),
      context = session.context();
    const proposal = context.actions.find(
      (a) =>
        a.type === command.type &&
        (!command.card ||
          context.observation.objects[a.card]?.name === previous.objects[command.card].name),
    );
    assert.ok(proposal, command.type);
    assert.equal(session.step(proposal).ok, true);
  }
  const context = session.context(),
    proposal = context.actions.find((a) => a.type === 'activate' && a.x === 1);
  assert.match(proposal.card, /^object:/);
  assert.match(proposal.sacrifices[0].id, /^object:/);
  assert.equal(session.step(proposal).ok, true);
  const entry = session.context().observation.stack.at(-1);
  assert.equal(entry.x, 1);
  assert.deepEqual(entry.activationCost.mana, { generic: 1 });
  assert.match(entry.source.id, /^object:/);
  assert.equal(session.exportReplay().commands.at(-1).x, 1);
});
test('activated X DOM chooses X before sacrifice, preserves reader/back, cancels without paying and submits once', async () => {
  const s = activatedXPosition(),
    o = Object.values(s.objects).find(
      (o) => o.name === 'Chosen Sacrificer' && o.zone === 'battlefield',
    );
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${o.id}"]`);
    h.click('[data-action="activateAbility"]');
    assert.match(h.dialog.textContent, /Choose X/);
    assert.match(h.dialog.textContent, /Cancel activation/);
    h.dialog.querySelector('#cast-x-value').value = '2';
    h.click('[data-action="chooseX"]');
    assert.match(h.dialog.textContent, /Choose X/);
    h.click('#dialog [data-action="closeDialog"]');
    assert.equal(h.dialog.open, false);
    h.click(`[data-card="${o.id}"]`);
    h.click('[data-action="activateAbility"]');
    h.click('[data-action="chooseX"][data-x="1"]');
    assert.match(h.dialog.textContent, /X = 1/);
    assert.ok(h.dialog.querySelector('[data-action="confirmActivationSacrifice"]').disabled);
    h.click('[data-action="selectActivationSacrifice"]');
    h.click('[data-action="readDecisionCard"]');
    h.click('[data-action="returnDecision"]');
    assert.match(h.dialog.textContent, /X = 1/);
    assert.equal(
      h.dialog.querySelector('[data-action="confirmActivationSacrifice"]').disabled,
      false,
    );
    const stale = h.click('[data-action="confirmActivationSacrifice"]');
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    const commands = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.filter(
      (c) => c.type === 'activate',
    );
    assert.equal(commands.length, 1);
    assert.equal(commands[0].x, 1);
    assert.equal(commands[0].sacrifices.length, 1);
    assert.match(h.document.querySelector('.stack-item').textContent, /X = 1/);
  } finally {
    h.cleanup();
  }
});
test('activated X DOM grouped targets retain X through selected-sacrifice confirmation', async () => {
  const s = activatedXPosition({
      targetGroups: [{ id: 'chosen', selector: 'creature', min: 1, max: 1 }],
      effects: [{ op: 'counterOn', amount: { kind: 'x' }, targetGroup: 'chosen' }],
    }),
    o = Object.values(s.objects).find(
      (o) => o.name === 'Chosen Sacrificer' && o.zone === 'battlefield',
    );
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${o.id}"]`);
    h.click('[data-action="activateAbility"]');
    h.click('[data-action="chooseX"][data-x="1"]');
    assert.ok(h.dialog.querySelector('[data-action="nextTargetGroup"]').disabled);
    h.click('[data-action="selectGroupTarget"]');
    assert.equal(h.dialog.querySelector('[data-action="nextTargetGroup"]').disabled, false);
    h.click('[data-action="nextTargetGroup"]');
    assert.match(h.dialog.textContent, /X = 1/);
    h.click('[data-action="selectActivationSacrifice"]');
    h.click('[data-action="confirmActivationSacrifice"]');
    const command = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.at(-1);
    assert.equal(command.x, 1);
    assert.equal(command.targets.chosen.length, 1);
    assert.equal(command.sacrifices.length, 1);
  } finally {
    h.cleanup();
  }
});
