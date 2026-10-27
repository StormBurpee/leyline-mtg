import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, resolve } from './helpers.js';
import { planPayment, pay } from '../src/mana.js';
import { dispatch } from '../src/index.js';

test('two-color hybrid casting accepts either color, split payment, and floating mana', () => {
  for (const colors of [
    ['U', 'U'],
    ['G', 'G'],
    ['U', 'G'],
  ]) {
    let s = fixture();
    for (const color of colors) s.players[0].mana[color]++;
    const card = put(s, 'Pond Prophet', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    assert.equal(
      Object.values(s.players[0].mana).reduce((a, b) => a + b, 0),
      0,
    );
    s = resolve(s);
    s = resolve(s);
    assert.equal(s.players[0].hand.length, 1);
  }
  const s = fixture();
  s.players[0].mana.R = 2;
  const card = put(s, 'Pond Prophet', 0, 'hand');
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: card.id }).ok, false);
});
test('hybrid matching preserves fixed colored and generic obligations without spending floating mana twice', () => {
  const s = fixture();
  s.players[0].mana.U = 1;
  put(s, 'Mountain');
  put(s, 'Forest');
  const cost = { U: 1, 'U/R': 1, generic: 1 };
  assert.ok(planPayment(s, 0, cost));
  pay(s, 0, cost);
  assert.equal(
    Object.values(s.players[0].mana).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(Object.values(s.objects).filter((o) => o.tapped).length, 2);
  const short = fixture();
  short.players[0].mana.U = 1;
  assert.equal(planPayment(short, 0, { 'U/R': 1, generic: 1 }), null);
});
test('uncounterable spells remain on the stack when a counterspell resolves', () => {
  let s = fixture();
  s.players[0].mana.G = 2;
  s.players[0].mana.C = 5;
  const bear = put(s, 'Gigantic Big Bear', 0, 'hand');
  const counter = put(s, 'Counterspell', 1, 'hand');
  s.players[1].mana.U = 2;
  s = act(s, 'cast', { card: bear.id });
  const id = s.stack.at(-1).id;
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target: { kind: 'stack', id } }, 1);
  s = resolve(s);
  assert.equal(s.stack.length, 1);
  assert.equal(s.objects[bear.id].zone, 'stack');
});
