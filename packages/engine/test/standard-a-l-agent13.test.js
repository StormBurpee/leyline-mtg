import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = ['Agent 13, Sharon Carter'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('Agent 13 roundtrips exactly', () => {
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

test('Agent13 investigates for exactly one declared creature, including herself', () => {
  for (const who of ['self', 'other', 'both']) {
    let s = rich();
    const agent = put(s, names[0]),
      bear = put(s, 'Grizzly Bears');
    s.step = 'attackers';
    s.choice = { kind: 'attackers', player: 0 };
    s = act(s, 'attackers', {
      cards: who === 'self' ? [agent.id] : who === 'other' ? [bear.id] : [agent.id, bear.id],
    });
    assert.equal(s.stack.length, who === 'both' ? 0 : 1);
    if (who !== 'both') {
      s.combat.attackers.push(ref(who === 'self' ? bear : agent));
      s = resolve(s);
      assert.equal(Object.values(s.objects).filter((o) => o.name === 'Clue Token').length, 1);
    }
  }
});
