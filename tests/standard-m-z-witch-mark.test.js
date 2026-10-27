import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  legalActions,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = ["Witch's Mark"];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('Witch’s Mark complete Role cards compile and round trip every clause', () => {
  for (const source of sources) {
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[source.name]);
    assert.equal(compiled.definition.text, source.rulesText);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, source.name + JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});

import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefieldBatch, stabilize } from '../packages/engine/src/effects.js';
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
import { notifyTriggers } from '../packages/engine/src/model.js';
import { move } from '../packages/engine/src/model.js';
function castMark(extraCard = true, withRecipient = true) {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const bear = put(s, 'Grizzly Bears');
  const discard = extraCard ? put(s, 'Forest', 0, 'hand') : null;
  const spell = put(s, "Witch's Mark", 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { recipient: withRecipient ? [ref(bear)] : [] } });
  return { s: resolve(s), bear, discard };
}
test('Witch’s Mark optionally discards exactly one then draws two before attaching Wicked', () => {
  let { s, bear, discard } = castMark();
  assert.equal(s.choice.kind, 'effectChoice');
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [discard.id] });
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.objects[discard.id].zone, 'graveyard');
  const aura = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Wicked',
  );
  assert.deepEqual(aura.attachedTo, ref(s.objects[bear.id]));
});
test('Witch’s Mark can decline the discard, including with an empty hand', () => {
  for (const extra of [false, true]) {
    let { s, bear } = castMark(extra);
    if (!extra)
      assert.deepEqual(
        s.choice.options.map((o) => o.index),
        [1],
      );
    s = act(s, 'chooseEffect', { option: 1 });
    assert.equal(s.players[0].hand.length, extra ? 1 : 0);
    assert(
      Object.values(s.objects).some(
        (o) => o.zone === 'battlefield' && o.name === 'Wicked' && o.attachedTo.id === bear.id,
      ),
    );
  }
});
test('Witch’s Mark works with zero Role targets, but fizzles if its chosen target becomes illegal', () => {
  let { s, discard } = castMark(true, false);
  s = act(s, 'chooseEffect', { option: 0 });
  s = act(s, 'discardEffect', { cards: [discard.id] });
  assert.equal(s.players[0].hand.length, 2);
  assert(!Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Wicked'));
  let t = fixture();
  lands(t, 'Mountain', 2);
  const bear = put(t, 'Grizzly Bears'),
    card = put(t, "Witch's Mark", 0, 'hand');
  put(t, 'Forest', 0, 'hand');
  t = act(t, 'cast', { card: card.id, targets: { recipient: [ref(bear)] } });
  move(t, t.objects[bear.id], 'exile');
  t = resolve(t);
  assert.equal(t.choice, null);
  assert.equal(t.players[0].hand.length, 1);
});
