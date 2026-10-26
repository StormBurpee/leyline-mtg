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
test('Sprite Dragon compiles its cast trigger and source counter without dropping the SVar', async () => {
  const result = compileForgeCard(await fixture('sprite_dragon'));
  assert.equal(result.status, 'candidate', result.diagnostics.join('\n'));
  assert.deepEqual(result.definition.triggers, CARDS['Sprite Dragon'].triggers);
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
test('legendary and land-creature combinations are not approximated', async () => {
  const text = await fixture('grizzly_bears');
  for (const type of ['Legendary Creature Bear', 'Land Creature Bear'])
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

for (const name of [
  'snapping_gnarlid',
  'makindi_sliderunner',
  'territorial_scythecat',
  'thermo_alchemist',
  'electrostatic_field',
])
  test(`Forge trigger fixture ${name} compiles to the implemented event predicate`, async () => {
    const result = compileForgeCard(await fixture(name));
    assert.equal(result.status, 'candidate', result.diagnostics.join('\n'));
    assert.deepEqual(result.definition.triggers, CARDS[result.name].triggers);
    if (CARDS[result.name].activated)
      assert.deepEqual(
        result.definition.activated[0].effects,
        CARDS[result.name].activated[0].effects,
      );
  });
for (const name of ['elvish_visionary', 'soul_warden'])
  test(`Forge ETB fixture ${name} keeps the enter predicate and effects`, async () => {
    const r = compileForgeCard(await fixture(name));
    assert.equal(r.status, 'candidate', r.diagnostics.join('\n'));
    assert.equal(
      r.definition.triggers[0].event,
      name === 'elvish_visionary' ? 'selfEnters' : 'otherCreatureEnters',
    );
  });
test('trigger conditions and alternate zones fail closed', async () => {
  const source = await fixture('snapping_gnarlid');
  for (const text of [
    source.replace('TriggerZones$ Battlefield', 'TriggerZones$ Graveyard'),
    source.replace('Mode$ ChangesZone', 'Mode$ ChangesZone | CheckSVar$ X'),
    source.replace('Destination$ Battlefield', 'Destination$ Graveyard'),
    source.replace('ValidCard$ Land.YouCtrl', 'ValidCard$ Land.OppCtrl'),
  ])
    assert.equal(compileForgeCard(text).status, 'unsupported');
});
test('prototype-named Forge opcodes reject instead of accessing inherited operand schemas', () => {
  for (const op of ['__proto__', 'constructor', 'toString'])
    assert.equal(
      compileForgeCard(`Name:Bad\nManaCost:U\nTypes:Instant\nA:SP$ ${op}`).status,
      'unsupported',
    );
});
test('only audited non-executable AI hints may remain unreferenced', async () => {
  const source = await fixture('snapping_gnarlid');
  assert.equal(
    compileForgeCard(source.replace('SVar:BuffedBy:Land', 'SVar:BuffedBy:Count$Valid Land')).status,
    'unsupported',
  );
  assert.equal(compileForgeCard(source + '\nSVar:Unused:DB$ Draw').status, 'unsupported');
});

for (const name of ['tranquil_cove', 'blossoming_sands'])
  test(`Forge nonbasic ${name} keeps its mana choices, tapped entry and life trigger`, async () => {
    const r = compileForgeCard(await fixture(name));
    assert.equal(r.status, 'candidate', r.diagnostics.join('\n'));
    assert.deepEqual(r.definition.mana, CARDS[r.name].mana);
    assert.equal(r.definition.entersTapped, true);
    assert.deepEqual(r.definition.triggers, [
      { event: 'selfEnters', effects: [{ op: 'gainLife', amount: 1 }] },
    ]);
  });
for (const name of ['tome_scour', 'mind_sculpt'])
  test(`Forge ${name} targets the correct player for milling`, async () => {
    const r = compileForgeCard(await fixture(name));
    assert.equal(r.status, 'candidate', r.diagnostics.join('\n'));
    assert.deepEqual(r.definition.effects, CARDS[r.name].effects);
    assert.equal(r.definition.target, CARDS[r.name].target);
  });
test('conditional tapped lands and unrelated replacement instructions are rejected', async () => {
  const source = await fixture('tranquil_cove');
  for (const text of [
    source.replace('ReplacementResult$ Updated', 'ReplacementResult$ Updated | CheckSVar$ X'),
    source.replace('DB$ Tap', 'DB$ Tap | SubAbility$ Draw'),
    source.replace('Produced$ Combo W U', 'Produced$ Chosen'),
    source.replace('Types:Land', 'Types:Land Plains Island'),
  ])
    assert.equal(compileForgeCard(text).status, 'unsupported');
});

for (const name of [
  'ornithopter',
  'memnite',
  'phyrexian_walker',
  'spirited_companion',
  'patchwork_automaton',
  'ornithopter_of_paradise',
  'darksteel_ingot',
  'enchantresss_presence',
  'mesa_enchantress',
  'beast_whisperer',
  'naturalize',
  'disenchant',
  'shatter',
  'boomerang',
])
  test(`Forge type-aware fixture ${name} retains its supported characteristics`, async () => {
    const r = compileForgeCard(await fixture(name));
    assert.equal(r.status, 'candidate', r.diagnostics.join('\n'));
    assert.equal(r.definition.type, CARDS[r.name].type);
    assert.deepEqual(r.definition.types, CARDS[r.name].types);
    if (CARDS[r.name].triggers) assert.deepEqual(r.definition.triggers, CARDS[r.name].triggers);
    if (CARDS[r.name].effects) assert.deepEqual(r.definition.effects, CARDS[r.name].effects);
    if (CARDS[r.name].mana) assert.deepEqual(r.definition.mana, CARDS[r.name].mana);
  });
test('an optional trigger cannot silently change its deciding player', async () => {
  const source = await fixture('mesa_enchantress');
  assert.equal(
    compileForgeCard(source.replace('OptionalDecider$ You', 'OptionalDecider$ Opponent')).status,
    'unsupported',
  );
});

for (const name of ['aether_adept', 'exclusion_mage', 'meteor_golem', 'sages_row_denizen'])
  test(`Forge ${name} preserves a targeted trigger as a real target choice`, async () => {
    const result = compileForgeCard(await fixture(name));
    assert.equal(result.status, 'candidate', result.diagnostics.join('\n'));
    assert.ok(result.definition.triggers[0].target);
    assert.ok(result.definition.triggers[0].effects.length);
  });
test('trigger executables require DB instructions and nested targets still fail explicitly', async () => {
  const source = await fixture('aether_adept');
  assert.equal(
    compileForgeCard(source.replace('DB$ ChangeZone', 'AB$ ChangeZone')).status,
    'unsupported',
  );
  const nested = source.replace(
    'SVar:TrigChangeZone:DB$ ChangeZone',
    'SVar:Second:DB$ Destroy | ValidTgts$ Artifact\nSVar:TrigChangeZone:DB$ ChangeZone | SubAbility$ Second',
  );
  const result = compileForgeCard(nested);
  assert.equal(result.status, 'unsupported');
  assert.ok(result.diagnostics.some((d) => d.includes('subability cannot introduce a new target')));
});
