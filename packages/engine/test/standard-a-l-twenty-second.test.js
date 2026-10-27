import test from 'node:test';
import { readFileSync } from 'node:fs';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
import { notifyTriggers, move } from '../src/model.js';
const names = [
  'Jeskai Monument',
  'Eye of Jace',
  'Elemental Mascot',
  'Hellspur Posse Boss',
  'Cactusfolk Sureshot',
  'Biomechan Engineer',
];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('six twenty-second-pass cards roundtrip exactly', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});

test('Jeskai Monument restricts basics to its three land types then sacrifices for exact Birds', () => {
  let s = rich();
  const island = put(s, 'Island', 0, 'library'),
    forest = put(s, 'Forest', 0, 'library');
  const r = cast(s, 'Jeskai Monument');
  s = resolve(r.s);
  assert.ok(s.choice.cards.includes(island.id));
  assert.ok(!s.choice.cards.includes(forest.id));
  s = act(s, 'searchLibrary', { cards: [island.id] });
  s = resolve(act(s, 'activate', { card: r.id, ability: 0 }));
  assert.equal(s.objects[r.id].zone, 'graveyard');
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'White Flying Bird Token').length,
    2,
  );
});
test('Eye of Jace tests seven cards after surveil rather than before it', () => {
  let s = rich();
  const eye = put(s, 'Eye of Jace');
  for (let i = 0; i < 6; i++) put(s, 'Grizzly Bears', 0, 'graveyard');
  s.step = 'untap';
  advanceStep(s);
  s = resolve(s);
  s = act(s, 'orderLibrary', { top: [], rest: s.choice.cards });
  assert.equal(s.objects[eye.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});
test('Hellspur gives new Mercenaries haste and Biomechan creates the larger Robot', () => {
  let s = rich();
  s = resolve(cast(s, 'Hellspur Posse Boss').s);
  const tokens = Object.values(s.objects).filter((o) => o.name === 'Mercenary Token');
  assert.equal(tokens.length, 2);
  assert.ok(keywords(s, tokens[0]).includes('haste'));
  const r = cast(s, 'Biomechan Engineer');
  s = resolve(r.s);
  s = resolve(act(s, 'activate', { card: r.id, ability: 0 }));
  assert.equal(s.players[0].hand.length, 2);
  const robot = Object.values(s.objects).find((o) => o.name === 'Robot Token');
  assert.equal(stats(s, robot).power, 2);
});
test('Cactusfolk grants trample and haste only to other sufficiently powerful creatures', () => {
  let s = rich();
  const source = put(s, 'Cactusfolk Sureshot'),
    big = put(s, 'Colossal Dreadmaw'),
    small = put(s, 'Grizzly Bears');
  s.step = 'main1';
  advanceStep(s);
  s = resolve(s);
  assert.ok(keywords(s, s.objects[big.id]).includes('haste'));
  assert.ok(!keywords(s, s.objects[small.id]).includes('haste'));
  assert.ok(!keywords(s, s.objects[source.id]).includes('haste'));
});
