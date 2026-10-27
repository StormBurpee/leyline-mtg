import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { notifyTargeted, resolveEffects } from '../src/effects.js';
import { ref } from '../src/model.js';
test('Surrak sees opponent target of controlled creature permanents and creature spells but not friendly or noncreature targets', () => {
  const s = fixture(),
    surrak = put(s, 'Surrak, Elusive Hunter'),
    elf = put(s, 'Llanowar Elves'),
    spell = put(s, 'Llanowar Elves', 0, 'stack'),
    land = put(s, 'Forest');
  s.stack.push({ id: 'testspell', kind: 'spell', source: ref(spell), controller: 0 });
  notifyTargeted(s, { id: 'a', kind: 'spell', controller: 1, target: ref(elf) });
  assert.equal(s.pendingTriggers.length, 1);
  notifyTargeted(s, {
    id: 'b',
    kind: 'ability',
    controller: 1,
    target: { kind: 'stack', id: 'testspell' },
  });
  assert.equal(s.pendingTriggers.length, 2);
  notifyTargeted(s, { id: 'c', kind: 'spell', controller: 0, target: ref(elf) });
  notifyTargeted(s, { id: 'd', kind: 'spell', controller: 1, target: ref(land) });
  assert.equal(s.pendingTriggers.length, 2);
  const before = s.players[0].hand.length;
  resolveEffects(s, s.pendingTriggers.pop());
  assert.equal(s.players[0].hand.length, before + 1);
});
test('a Surrak spell is uncounterable but does not itself observe targeting before entering', () => {
  let s = fixture();
  lands(s, 'Forest', 3);
  const card = put(s, 'Surrak, Elusive Hunter', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  assert.equal(s.stack[0].uncounterable, true);
  notifyTargeted(s, {
    id: 'a',
    kind: 'spell',
    controller: 1,
    target: { kind: 'stack', id: s.stack[0].id },
  });
  assert.equal(s.pendingTriggers.length, 0);
});
