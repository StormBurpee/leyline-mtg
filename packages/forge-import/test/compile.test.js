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
  assert.ok(result.diagnostics.some((x) => x.includes('SVar')));
});
test('unknown keywords fail closed', async () => {
  const text = (await fixture('grizzly_bears')) + '\nK:Protection:Red';
  const r = compileForgeCard(text);
  assert.equal(r.status, 'unsupported');
  assert.ok(r.diagnostics.some((x) => x.includes('Protection')));
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

for (const name of [
  'opt',
  'preordain',
  'consider',
  'merfolk_looter',
  'llanowar_elves',
  'giant_growth',
  'shivan_dragon',
])
  test(`Forge chained/activated fixture ${name} lowers to the current engine`, async () => {
    const r = compileForgeCard(await fixture(name));
    assert.equal(r.status, 'candidate', r.diagnostics.join('\n'));
    const expected = CARDS[r.name];
    assert.deepEqual(r.definition.cost, expected.cost);
    if (expected.effects) assert.deepEqual(r.definition.effects, expected.effects);
    if (expected.mana) assert.equal(r.definition.mana, expected.mana);
    if (expected.activated) {
      assert.deepEqual(r.definition.activated[0].cost, expected.activated[0].cost);
      assert.deepEqual(r.definition.activated[0].effects, expected.activated[0].effects);
    }
  });
test('cyclic and missing SubAbility references are rejected', () => {
  const head = 'Name:Test\nManaCost:U\nTypes:Instant\nA:SP$ Draw | SubAbility$ Next';
  for (const suffix of ['', '\nSVar:Next:DB$ Draw | SubAbility$ Next'])
    assert.equal(compileForgeCard(head + suffix).status, 'unsupported');
});
test('unused SVars and dynamic expressions remain visible errors', async () => {
  const text = await fixture('opt');
  assert.equal(compileForgeCard(text + '\nSVar:X:Count$Valid Creature').status, 'unsupported');
  assert.equal(compileForgeCard(text.replace('ScryNum$ 1', 'ScryNum$ X')).status, 'unsupported');
});
test('new subability targets and optional effects are not silently translated', async () => {
  const text = await fixture('opt');
  for (const extra of [' | ValidTgts$ Player', ' | Optional$ True'])
    assert.equal(
      compileForgeCard(text.replace('DB$ Draw', 'DB$ Draw' + extra)).status,
      'unsupported',
    );
});

for (const name of [
  'waterfall_aerialist',
  'rimeshield_frost_giant',
  'tomakul_honor_guard',
  'owlin_shieldmage',
  'sire_of_seven_deaths',
  'dwarven_forge_chanter',
])
  test(`Forge ward fixture ${name} preserves the payment and every keyword`, async () => {
    const result = compileForgeCard(await fixture(name));
    assert.equal(result.status, 'candidate', result.diagnostics.join('\n'));
    assert.deepEqual(result.definition.ward, CARDS[result.name].ward);
    assert.deepEqual(result.definition.keywords, CARDS[result.name].keywords);
    assert.deepEqual(result.definition.triggers, CARDS[result.name].triggers);
  });
test('multiple ward instances and nonimplemented ward costs are rejected', async () => {
  const source = await fixture('waterfall_aerialist');
  for (const text of [
    source + '\nK:Ward:1',
    source.replace('K:Ward:2', 'K:Ward:Discard<1/Card>'),
    source.replace('K:Ward:2', 'K:Ward:T'),
  ])
    assert.equal(compileForgeCard(text).status, 'unsupported');
});
