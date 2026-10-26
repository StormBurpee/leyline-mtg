import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileForgeCard } from '../compile.js';
import { CARDS, createRegistry, stats, ref, playerView } from '../../engine/src/index.js';
import { fixture, put, lands, act, resolve } from '../../engine/test/helpers.js';

async function imported(name) {
  const source = await readFile(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
  const compiled = compileForgeCard(source);
  assert.equal(compiled.status, 'candidate', compiled.diagnostics.join('\n'));
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, [compiled.name]: compiled.definition });
  return { s, name: compiled.name };
}

test('imported Opt executes its DB continuation with private scry information', async () => {
  let { s, name } = await imported('opt');
  lands(s, 'Island', 1);
  const card = put(s, name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  const top = s.choice.cards[0],
    next = s.players[0].library[1];
  assert.equal(s.choice.action, 'scry');
  assert.equal(playerView(s, 1).choice.kind, 'opponentChoice');
  s = act(s, 'orderLibrary', { top: [], rest: [top] });
  assert.deepEqual(s.players[0].hand, [next]);
  assert.equal(s.players[0].library.at(-1), top);
  assert.equal(s.objects[card.id].zone, 'graveyard');
});

test('imported Consider puts the surveilled card in the graveyard before drawing', async () => {
  let { s, name } = await imported('consider');
  lands(s, 'Island', 1);
  const card = put(s, name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  const top = s.choice.cards[0],
    next = s.players[0].library[1];
  s = act(s, 'orderLibrary', { top: [], rest: [top] });
  assert.equal(s.objects[top].zone, 'graveyard');
  assert.deepEqual(s.players[0].hand, [next]);
});

test('imported Looter pays a tap cost and resumes after choosing the discard', async () => {
  let { s, name } = await imported('merfolk_looter');
  const card = put(s, name);
  s = resolve(act(s, 'activate', { card: card.id, ability: 0 }));
  assert.equal(s.objects[card.id].tapped, true);
  assert.equal(s.choice.kind, 'discardEffect');
  const drawn = s.players[0].hand[0];
  s = act(s, 'discardEffect', { cards: [drawn] });
  assert.equal(s.objects[drawn].zone, 'graveyard');
  assert.equal(s.resolving, null);
});

test('imported Giant Growth modifies its target, not its source', async () => {
  let { s, name } = await imported('giant_growth');
  lands(s, 'Forest', 1);
  const bear = put(s, 'Grizzly Bears'),
    card = put(s, name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id, target: ref(bear) }));
  assert.deepEqual(stats(s, s.objects[bear.id]), { power: 5, toughness: 5 });
  assert.equal(s.objects[card.id].zone, 'graveyard');
});
