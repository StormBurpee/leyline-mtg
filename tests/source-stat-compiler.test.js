import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = ['ashroot-animist', 'halana-and-alena-partners', 'war-machine-legacy-of-iron'];
for (const name of names)
  test(`${name}: exact source compiles and native round-trips`, () => {
    const source = JSON.parse(
      readFileSync(new URL(`../packages/cards/cards/${name}.json`, import.meta.url)),
    );
    const first = compileCard(source);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const back = sourceFromDefinition(first.definition, { id: source.id });
    const second = compileCard(back);
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(canonical(first.definition), canonical(second.definition));
  });
