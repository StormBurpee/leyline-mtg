import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard } from '../../cards/compiler.js';
import { matchesFilter, effectTargetCompatible } from '../src/selectors.js';

const schema = JSON.parse(
  readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

for (const [name, slug, subtype] of [
  ['Iron Hills', 'iron-hills', 'Dwarf'],
  ['Lake-town', 'lake-town', 'Human'],
]) {
  test(`${name} targets the printed controlled subtype without an extra creature restriction`, () => {
    const source = JSON.parse(
      readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url), 'utf8'),
    );
    assert.ok(validate(source), JSON.stringify(validate.errors));
    const compiled = compileCard(source);
    assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
    const ability = compiled.definition.activated[0];
    assert.equal(ability.target.scope, 'permanent');
    assert.ok(effectTargetCompatible('counterOn', ability.target));

    // Predicate-level contract only: this does not enable any additional card type.
    const facts = {
      definition: { type: 'artifact', types: ['artifact'], subtypes: [subtype], keywords: [] },
      controller: 0,
      owner: 1,
    };
    assert.ok(matchesFilter(facts, ability.target.where, 0));
    assert.ok(!matchesFilter({ ...facts, controller: 1, owner: 0 }, ability.target.where, 0));
    assert.ok(
      !matchesFilter(
        { ...facts, definition: { ...facts.definition, subtypes: ['Goblin'] } },
        ability.target.where,
        0,
      ),
    );
    assert.ok(
      matchesFilter(
        { ...facts, definition: { ...facts.definition, type: 'creature', types: ['creature'] } },
        ability.target.where,
        0,
      ),
    );
    assert.deepEqual(ability.target.where, { all: [{ controller: 'you' }, { subtype }] });
  });
}
