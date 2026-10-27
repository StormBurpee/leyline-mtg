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
  'Aerid Konstrari',
  'Fire Nation Attacks',
  'Ka-Zar of the Savage Land',
  'Caught in the Crossfire',
  'Annie Flash, the Veteran',
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
test('five twentieth-pass cards roundtrip exactly', () => {
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

test('Aerid creates Heartwood before counting artifacts for its power increase', () => {
  let s = rich();
  const r = cast(s, 'Aerid Konstrari');
  s = resolve(r.s);
  const base = stats(s, s.objects[r.id]).power;
  s = resolve(act(s, 'activate', { card: r.id, ability: 0 }));
  assert.equal(stats(s, s.objects[r.id]).power, base + 2);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Heartwood').length, 2);
});
test('Ka-Zar creates exact legendary Zabu with landfall counter growth', () => {
  let s = rich();
  s = resolve(cast(s, 'Ka-Zar of the Savage Land').s);
  const cat = Object.values(s.objects).find((o) => o.name === 'Zabu');
  assert.ok(cat);
  assert.equal(CARDS.Zabu.legendary, true);
  const land = put(s, 'Forest', 0, 'hand');
  enterBattlefield(s, land, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[cat.id].plusCounters, 1);
});
test('Fire Nation Attacks makes two 2/2 red firebending Soldiers rather than vanilla tokens', () => {
  let s = rich();
  s = cast(s, 'Fire Nation Attacks').s;
  const soldiers = Object.values(s.objects).filter((o) => o.name === 'Firebending Soldier Token');
  assert.equal(soldiers.length, 2);
  assert.equal(stats(s, soldiers[0]).power, 2);
  const mana = s.players[0].restrictedMana?.length ?? 0;
  notifyTriggers(s, 'attack', { object: soldiers[0] });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].restrictedMana.length, mana + 1);
});
test('Caught in the Crossfire both modes deal two to each category, not four to outlaws', () => {
  let s = rich();
  const outlaw = put(s, 'Crossbones, Malicious Mercenary'),
    normal = put(s, 'Colossal Dreadmaw');
  s = cast(s, 'Caught in the Crossfire', { mode: 2 }).s;
  assert.equal(s.objects[outlaw.id].damage, 2);
  assert.equal(s.objects[normal.id].damage, 2);
});
test('Annie Flash returns a cheap permanent tapped only when cast, then tap triggers exile two', () => {
  let s = rich();
  const land = put(s, 'Forest', 0, 'graveyard');
  const r = cast(s, 'Annie Flash, the Veteran');
  s = r.s;
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].tapped, true);
  notifyTriggers(s, 'tap', { object: s.objects[r.id] });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].exile.length, 2);
});
