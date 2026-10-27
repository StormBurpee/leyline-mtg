import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, castingProfile, stats } from '../src/index.js';
import { definition } from '../src/model.js';
import { matchesFilter } from '../src/selectors.js';
import { CREATURE_TYPES, subtypesOf, hasSubtype } from '../src/creature-types.js';
import { manaEligible } from '../src/mana.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

// CR 702.73 / official ECL release notes: characteristic-defining in every zone.
// https://magic.wizards.com/en/news/feature/lorwyn-eclipsed-release-notes
const name = 'Gangly Stompling';
test('changeling matches every creature subtype in every zone, but not other subtype families', () => {
  const s = fixture();
  for (const zone of ['library', 'hand', 'stack', 'battlefield', 'graveyard', 'exile']) {
    const object = put(s, name, 0, zone);
    const d = definition(s, object);
    assert.deepEqual(d.subtypes, ['Shapeshifter'], 'printed types remain losslessly serializable');
    for (const subtype of CREATURE_TYPES)
      assert.equal(matchesFilter({ definition: d }, { subtype }, 0), true, `${zone}: ${subtype}`);
    for (const subtype of ['Forest', 'Equipment', 'Aura', 'Vehicle', 'MadeUpCreatureType'])
      assert.equal(matchesFilter({ definition: d }, { subtype }, 0), false, `${zone}: ${subtype}`);
    assert.deepEqual(new Set(subtypesOf(d)), new Set(CREATURE_TYPES));
  }
});
test('face-down characteristics and fixed-type copy definitions do not inherit original changeling', () => {
  const s = fixture();
  const object = put(s, name);
  object.faceDown = true;
  assert.equal(hasSubtype(definition(s, object), 'Elf'), false);
  assert.deepEqual(subtypesOf(definition(s, object)), []);
  delete object.faceDown;
  // A copy exception specifying fixed types does not copy a type-defining ability.
  object.definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: ['Frog'] };
  assert.equal(hasSubtype(definition(s, object), 'Frog'), true);
  assert.equal(hasSubtype(definition(s, object), 'Elf'), false);
  delete object.definitionOverride;
  assert.equal(hasSubtype(definition(s, object), 'Elf'), true);
  // A layer-6 grant is not a printed CDA and must not invent layer-4 types.
  assert.equal(
    matchesFilter(
      { definition: CARDS['Grizzly Bears'], keywords: ['changeling'] },
      { subtype: 'Elf' },
      0,
    ),
    false,
  );
});
test('tribal cost reduction applies once even when changeling matches both tribes', () => {
  const s = fixture();
  put(s, 'Ballyrush Banneret');
  const object = put(s, name, 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, object).cost, { generic: 1, 'R/G': 1 });
});
test('tribal cast and enter triggers and anthems recognize changeling', () => {
  let s = fixture();
  const watcher = 'Tribal watcher';
  s.catalog = createRegistry({
    ...CARDS,
    [watcher]: {
      name: watcher,
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      static: { kind: 'anthem', where: { subtype: 'Elf' }, power: 1, toughness: 1 },
      triggers: ['cast', 'enter'].map((event) => ({
        event: { event, controller: 'you', filter: { subtype: 'Elf' } },
        effects: [{ op: 'gainLife', amount: 1 }],
      })),
    },
  });
  put(s, watcher);
  lands(s, 'Forest', 3);
  const object = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: object.id });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  s = resolve(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(stats(s, s.objects[object.id]).power, 5);
});
test('Cavern chosen creature-type mana casts and protects a changeling', () => {
  let s = fixture();
  const cavern = put(s, 'Cavern of Souls', 0, 'hand');
  s = act(s, 'playLand', { card: cavern.id });
  s = act(s, 'chooseCreatureType', { creatureType: 'Sliver' });
  lands(s, 'Forest', 2);
  const object = put(s, name, 0, 'hand');
  s = act(s, 'tapMana', { card: cavern.id, color: 'G' });
  s = act(s, 'cast', { card: object.id });
  assert.equal(s.stack.at(-1).uncounterable, true);
  assert.equal(
    manaEligible(
      { restriction: 'chosenCreatureType', creatureType: 'Forest' },
      { type: 'cast', card: CARDS[name] },
    ),
    false,
  );
});
test('dynamic changeling grants stay rejected until type-layer dependencies are supported', async () => {
  const { validateDefinition } = await import('../src/index.js');
  const base = { name: 'Grant fixture', type: 'creature', cost: {}, power: 2, toughness: 2 };
  const grants = [
    { maxSpeedKeywords: ['changeling'] },
    { static: { kind: 'anthem', power: 0, toughness: 0, keywords: ['changeling'] } },
    {
      conditionalBonuses: [
        {
          affects: 'self',
          condition: { kind: 'controllerTurn' },
          power: 0,
          toughness: 0,
          keywords: ['changeling'],
        },
      ],
    },
    {
      subtypes: ['Equipment'],
      attachmentBonus: { power: 0, toughness: 0, keywords: ['changeling'] },
    },
    {
      etb: [{ op: 'modify', subject: 'source', power: 0, toughness: 0, keywords: ['changeling'] }],
    },
    {
      etb: [
        {
          op: 'modifyAll',
          where: { type: 'creature' },
          power: 0,
          toughness: 0,
          keywords: ['changeling'],
        },
      ],
    },
    {
      etb: [
        { op: 'token', definition: 'Soldier Token', count: 1, temporaryKeywords: ['changeling'] },
      ],
    },
  ];
  assert.deepEqual(validateDefinition({ ...base, keywords: ['changeling'] }), []);
  for (const grant of grants) {
    const errors = validateDefinition({ ...base, ...grant });
    assert.ok(errors.length, JSON.stringify(grant));
    // Ensure this fixture is otherwise legal, rather than hiding another rejection.
    const ordinary = JSON.parse(JSON.stringify(grant).replaceAll('changeling', 'flying'));
    assert.deepEqual(validateDefinition({ ...base, ...ordinary }), [], JSON.stringify(ordinary));
  }
});
