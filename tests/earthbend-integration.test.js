import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  dispatch,
  chooseBotCommand,
  exportReplay,
  replay,
  CARDS,
} from '../packages/engine/src/index.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { inspect } from '../apps/web/view.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
test('earthbend and nested quest-reflexive instructions survive native/source roundtrip', () => {
  for (const name of ['Ba Sing Se', 'Earthbender Ascension']) {
    const source = sourceFromDefinition(CARDS[name], {
      id: `test:${name.toLowerCase().replaceAll(' ', '-')}`,
    });
    const compiled = compileCard(source);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(canonical(compiled.definition), canonical(CARDS[name]));
  }
});
test('quest counters are readable in card inspector', () => {
  const s = fixture(),
    a = put(s, 'Earthbender Ascension');
  a.questCounters = 4;
  const html = inspect(a.name, {}, s, a.id, 0);
  assert.match(html, /4 quest counters/);
});
test('earthbend meta play sequence replays deterministically with quest counters and delayed returns', () => {
  const deck = [
    ...Array(12).fill('Forest'),
    ...Array(4).fill('Ba Sing Se'),
    ...Array(4).fill('Earthbender Ascension'),
  ];
  let s = createGame({ decks: [deck, deck], minimumDeckSize: 20, mulligan: false, seed: 731 });
  for (let i = 0; i < 180 && !s.winner; i++) {
    const command = chooseBotCommand(s, s.choice?.player ?? s.priority);
    const result = dispatch(s, command);
    assert.ok(result.ok, JSON.stringify(result.error));
    s = result.state;
  }
  assert.ok(s.events.some((e) => e.type === 'earthbent'));
  assert.ok(Object.values(s.objects).some((o) => o.questCounters));
  assert.deepEqual(replay(exportReplay(s)), s);
});
