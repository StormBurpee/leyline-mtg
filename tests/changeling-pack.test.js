import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, ref } from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
const names = [
  'Feisty Spikeling',
  'Taurean Mauler',
  'Changeling Wayfinder',
  'Rooftop Percher',
  'Chitinous Graspling',
  'Chomping Changeling',
  'Gangly Stompling',
  'Graveshifter',
  'Mischievous Sneakling',
  'Prideful Feastling',
];
test('ten complete changeling sources retain Oracle text and round-trip without losing their CDA', async () => {
  for (const name of names) {
    const slug = name.toLowerCase().replaceAll(' ', '-');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    assert.match(source.rulesText, /^Changeling \(This card is every creature type\.\)/);
    const compiled = compileCard(source);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[name]);
    const restored = compileCard(sourceFromDefinition(compiled.definition, { id: source.id }));
    assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
    assert.deepEqual(restored.definition, compiled.definition);
  }
});
test('Chomping Changeling destroys its selected artifact or may select none', () => {
  for (const chooseTarget of [false, true]) {
    let s = fixture();
    lands(s, 'Forest', 3);
    const artifact = put(s, 'Short Bow', 1);
    const card = put(s, 'Chomping Changeling', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    s = resolve(s);
    s = act(s, 'chooseTriggerTargets', {
      targets: { chosen: chooseTarget ? [ref(artifact)] : [] },
    });
    s = resolve(s);
    assert.equal(s.objects[artifact.id].zone, chooseTarget ? 'graveyard' : 'battlefield');
  }
});
test('Graveshifter optionally returns the targeted creature card to hand', () => {
  for (const accept of [false, true]) {
    let s = fixture();
    lands(s, 'Swamp', 4);
    const fallen = put(s, 'Gangly Stompling', 0, 'graveyard');
    const card = put(s, 'Graveshifter', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    s = resolve(s);
    s = act(s, 'chooseTriggerTarget', { target: ref(fallen) });
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept });
    assert.equal(s.objects[fallen.id].zone, accept ? 'hand' : 'graveyard');
  }
});
test('Rooftop Percher exiles cards from either graveyard and gains life even with no targets', () => {
  for (const count of [0, 2]) {
    let s = fixture();
    lands(s, 'Plains', 5);
    const cards = [put(s, 'Forest', 0, 'graveyard'), put(s, 'Island', 1, 'graveyard')];
    const card = put(s, 'Rooftop Percher', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    s = resolve(s);
    s = act(s, 'chooseTriggerTargets', { targets: { cards: cards.slice(0, count).map(ref) } });
    s = resolve(s);
    assert.equal(s.players[0].life, 23);
    for (const target of cards)
      assert.equal(s.objects[target.id].zone, count ? 'exile' : 'graveyard');
  }
});
test('Wayfinder may decline searching or reveal a basic land into hand and shuffle', () => {
  for (const accept of [false, true]) {
    let s = fixture();
    lands(s, 'Forest', 3);
    const card = put(s, 'Changeling Wayfinder', 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id }));
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept });
    if (accept) {
      assert.equal(s.choice.kind, 'librarySearch');
      const id = s.choice.cards[0];
      assert.ok(CARDS[s.objects[id].name].basic);
      s = act(s, 'searchLibrary', { cards: [id] });
      assert.equal(s.objects[id].zone, 'hand');
      assert.ok(s.events.some((e) => e.type === 'libraryShuffled'));
    } else assert.equal(s.choice, null);
  }
});
test('Feisty Spikeling first strike follows its controller’s turn', async () => {
  const { keywords } = await import('../packages/engine/src/index.js');
  const s = fixture();
  const card = put(s, 'Feisty Spikeling');
  assert.ok(keywords(s, card).includes('first strike'));
  s.active = 1;
  assert.ok(!keywords(s, card).includes('first strike'));
});
test('Taurean Mauler optionally grows only when an opponent casts', async () => {
  const { stats } = await import('../packages/engine/src/index.js');
  for (const accept of [false, true]) {
    let s = fixture();
    const mauler = put(s, 'Taurean Mauler');
    const own = put(s, 'Ornithopter', 0, 'hand');
    s = act(s, 'cast', { card: own.id });
    assert.equal(s.stack.length, 1);
    s = resolve(s);
    s.active = 1;
    s.priority = 1;
    const other = put(s, 'Ornithopter', 1, 'hand');
    s = act(s, 'cast', { card: other.id });
    assert.equal(s.stack.length, 2);
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept });
    assert.equal(stats(s, s.objects[mauler.id]).power, accept ? 3 : 2);
  }
});
