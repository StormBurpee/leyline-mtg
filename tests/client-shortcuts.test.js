import test from 'node:test';
import assert from 'node:assert/strict';
import { duelShortcut } from '../apps/web/duel-shortcuts.js';
const context = { hasState: true, view: 'play', hasPriority: true, hasChoice: false };
const key = (key, targetTag = 'BUTTON', extra = {}, state = {}) =>
  duelShortcut({ key, targetTag, ...extra }, { ...context, ...state });
test('Escape and full control work while a card button has focus', () => {
  assert.equal(key('Escape'), 'cancelSelection');
  assert.equal(key('f'), 'toggleFullControl');
  assert.equal(key('F'), 'toggleFullControl');
});
test('typing, browser modifiers and modal dialogs are never hijacked', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(key('f', tag), null);
  assert.equal(key('f', 'DIV', { editable: true }), null);
  assert.equal(key('f', 'BUTTON', { ctrlKey: true }), null);
  assert.equal(key('f', 'BUTTON', {}, { dialogOpen: true }), null);
});
test('ordinary button Enter and Space keep native activation', () => {
  assert.equal(key('Enter'), null);
  assert.equal(key(' ', 'BUTTON', { code: 'Space' }), null);
  assert.equal(key(' ', 'BODY', { code: 'Space' }), 'pass');
});
test('selected hand Enter plays, but another card and unfinished targeting do not', () => {
  assert.equal(key('Enter', 'BUTTON', { focusedCard: 'a' }, { selected: 'a' }), 'playSelected');
  assert.equal(key('Enter', 'BUTTON', { focusedCard: 'b' }, { selected: 'a' }), null);
  assert.equal(
    key('Enter', 'BUTTON', { focusedCard: 'a' }, { selected: 'a', targeting: true }),
    null,
  );
});
test('explicit Shift Enter can pass the turn from a focused control', () => {
  assert.equal(key('Enter', 'BUTTON', { shiftKey: true }), 'yieldTurn');
  assert.equal(key('Enter', 'BUTTON', { shiftKey: true }, { replay: true }), null);
});
