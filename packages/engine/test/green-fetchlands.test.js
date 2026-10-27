import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { playerView } from '../src/model.js';
import { chooseBotCommand } from '../src/index.js';
const findBasic = (s) =>
  s.choice.cards.find((id) => s.objects[id].name === 'Forest') ?? s.choice.cards[0];
test('Fabled Passage checks four lands after fetched land enters and untaps only that incarnation', () => {
  for (const n of [2, 3]) {
    let s = fixture();
    lands(s, 'Forest', n);
    const fetch = put(s, 'Fabled Passage');
    s = act(s, 'activate', { card: fetch.id, ability: 0 });
    s = resolve(s);
    const id = findBasic(s);
    s = act(s, 'searchLibrary', { cards: [id] });
    assert.equal(s.objects[id].tapped, n < 3);
    assert.equal(s.objects[fetch.id].zone, 'graveyard');
  }
});
test('Elven Passage optional behold chooses controlled Elf without revealing hand, or reveals Elf from hand', () => {
  for (const zone of ['battlefield', 'hand']) {
    let s = fixture();
    const elf = put(s, 'Llanowar Elves', 0, zone),
      fetch = put(s, 'Elven Passage');
    s = act(s, 'activate', { card: fetch.id, ability: 0 });
    assert.equal(s.players[0].life, 19);
    s = resolve(s);
    const id = findBasic(s);
    s = act(s, 'searchLibrary', { cards: [id] });
    assert.equal(s.choice.kind, 'behold');
    assert.equal(s.objects[id].tapped, true);
    assert.equal(playerView(s, 1).choice.kind, 'opponentChoice');
    assert.equal(chooseBotCommand(playerView(s, 0), 0).card, elf.id);
    s = act(s, 'chooseResolutionCard', { card: elf.id });
    assert.equal(s.objects[id].tapped, false);
    assert.equal(
      s.events.some((e) => e.type === 'revealed' && e.objectId === elf.id),
      zone === 'hand',
    );
  }
});
test('Elven Passage may decline behold and fail-to-find still reaches behold', () => {
  let s = fixture();
  const fetch = put(s, 'Elven Passage');
  s = act(s, 'activate', { card: fetch.id, ability: 0 });
  s = resolve(s);
  s = act(s, 'searchLibrary', { cards: [] });
  assert.equal(s.choice.kind, 'behold');
  s = act(s, 'chooseResolutionCard', { card: null });
  assert.equal(s.choice, null);
});
test('Demolition Field uses destroyed land controller first then its own controller; both may decline', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const fetch = put(s, 'Demolition Field'),
    target = put(s, 'Fabled Passage', 1);
  s = act(s, 'activate', {
    card: fetch.id,
    ability: 0,
    target: { kind: 'object', id: target.id, incarnation: target.incarnation },
  });
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  assert.equal(s.choice.player, 0);
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  assert.equal(s.choice, null);
});
