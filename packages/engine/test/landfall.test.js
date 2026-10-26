import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, createRegistry, stats } from '../src/index.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { compileForgeCard } from '../../forge-import/compile.js';
import { fixture, put, act, resolve } from './helpers.js';
test('playing a land triggers landfall without using the stack for the land itself', () => {
  let s = fixture();
  const gnarlid = put(s, 'Snapping Gnarlid'),
    land = put(s, 'Forest', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.stack.length, 1);
  assert.equal(stats(s, s.objects[gnarlid.id]).power, 2);
  s = resolve(s);
  assert.equal(stats(s, s.objects[gnarlid.id]).power, 3);
});
test('landfall watches controlled lands entering, not opponents lands or only land plays', () => {
  let s = fixture();
  const cat = put(s, 'Territorial Scythecat'),
    foreign = put(s, 'Forest', 1, 'hand'),
    own = put(s, 'Forest', 0, 'hand');
  enterBattlefield(s, foreign, 1);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  enterBattlefield(s, own, 0);
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[cat.id].plusCounters, 1);
});
test('multiple landfall abilities require explicit same-controller stack ordering', () => {
  let s = fixture();
  put(s, 'Snapping Gnarlid');
  put(s, 'Makindi Sliderunner');
  const land = put(s, 'Forest', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
});
test('a migrated Elvish Visionary enters and draws through the same trigger engine', async () => {
  const text = await readFile(
    new URL('../../forge-import/test/fixtures/elvish_visionary.txt', import.meta.url),
    'utf8',
  );
  const { definition } = compileForgeCard(text);
  let s = fixture();
  s.catalog = createRegistry({ ...CARDS, [definition.name]: definition });
  const elf = put(s, definition.name, 0, 'hand');
  s.players[0].mana.G = 2;
  s = resolve(act(s, 'cast', { card: elf.id }));
  assert.equal(s.stack.length, 1);
  assert.equal(s.players[0].hand.length, 0);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
