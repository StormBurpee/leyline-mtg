import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileForgeCard } from '../compile.js';
import { CARDS } from '../../engine/src/index.js';
const fixture = async (name) =>
  readFile(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
for (const name of [
  'grizzly_bears',
  'island',
  'monastery_swiftspear',
  'lightning_bolt',
  'counterspell',
  'divination',
  'murder',
  'unsummon',
])
  test(`Forge fixture ${name} compiles to a reviewable candidate`, async () => {
    const result = compileForgeCard(await fixture(name));
    assert.equal(result.status, 'candidate', result.diagnostics.join('\n'));
    const expected = CARDS[result.name];
    assert.equal(result.definition.type, expected.type);
    assert.deepEqual(result.definition.cost, expected.cost);
    assert.deepEqual(result.definition.keywords, expected.keywords);
    if (expected.effects) assert.deepEqual(result.definition.effects, expected.effects);
    if (expected.triggers) assert.deepEqual(result.definition.triggers, expected.triggers);
  });
test('Sprite Dragon remains unsupported rather than dropping its trigger/SVar', async () => {
  const result = compileForgeCard(await fixture('sprite_dragon'));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.definition, null);
  assert.ok(result.diagnostics.some((x) => x.includes('unsupported field T')));
  assert.ok(result.diagnostics.some((x) => x.includes('unsupported field SVar')));
});
test('unknown keywords fail closed', async () => {
  const text = (await fixture('grizzly_bears')) + '\nK:Ward:2';
  const r = compileForgeCard(text);
  assert.equal(r.status, 'unsupported');
  assert.ok(r.diagnostics.some((x) => x.includes('Ward')));
});
test('extra spell restrictions are never silently discarded', async () => {
  const text = (await fixture('lightning_bolt')).replace('NumDmg$ 3', 'NumDmg$ 3 | TargetMin$ 0');
  const r = compileForgeCard(text);
  assert.equal(r.status, 'unsupported');
  assert.ok(r.diagnostics.some((x) => x.includes('TargetMin')));
});
test('fields valid on a different opcode are rejected', async () => {
  const text = (await fixture('divination')).replace('NumCards$ 2', 'NumCards$ 2 | NumDmg$ 3');
  assert.equal(compileForgeCard(text).status, 'unsupported');
});
test('symbolic amounts, hybrid costs and multiple spell abilities require manual migration', async () => {
  const text = await fixture('lightning_bolt');
  for (const variant of [
    text.replace('NumDmg$ 3', 'NumDmg$ X'),
    text.replace('ManaCost:R', 'ManaCost:2/R'),
    text + '\nA:SP$ Draw | NumCards$ 1',
  ])
    assert.equal(compileForgeCard(variant).status, 'unsupported');
});
test('legendary and multi-type creatures are not approximated', async () => {
  const text = await fixture('grizzly_bears');
  for (const type of ['Legendary Creature Bear', 'Artifact Creature Bear'])
    assert.equal(
      compileForgeCard(text.replace('Types:Creature Bear', `Types:${type}`)).status,
      'unsupported',
    );
});
test('duplicate required fields and malformed lines are diagnostic', async () => {
  const text = await fixture('island');
  assert.equal(compileForgeCard(text + '\nName:Second\ninvalid line').status, 'unsupported');
});
test('unsupported card text is never interpreted as executable code', () => {
  const r = compileForgeCard(
    'Name:Injected\nManaCost:R\nTypes:Instant\nOracle:Draw a card.\nSVar:Execute:process.exit()',
  );
  assert.equal(r.status, 'unsupported');
  assert.equal(r.definition, null);
});
