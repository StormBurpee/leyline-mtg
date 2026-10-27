import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, stats } from '../src/index.js';
import { move, notifyTriggers, keywords, ref } from '../src/model.js';
import { declareAttackers } from '../src/combat.js';
import { resolveTop, stabilize } from '../src/effects.js';
import { fixture, put } from './helpers.js';
const tokens = (s) =>
  Object.values(s.objects).filter(
    (o) => o.name === 'Mobilized Warrior Token' && o.zone === 'battlefield',
  );
const attack = (s, object) => {
  s.step = 'attackers';
  declareAttackers(s, [object.id]);
  stabilize(s);
};
const end = (s) => {
  s.step = 'end';
  notifyTriggers(s, 'step', { player: s.active, step: 'end' });
  stabilize(s);
};
test('mobilize creates tapped attackers, not declared attackers, and waits for next end step', () => {
  const s = fixture();
  const d = put(s, 'Dalkovan Packbeasts');
  attack(s, d);
  assert.equal(s.stack.length, 1);
  move(s, d, 'graveyard');
  resolveTop(s);
  assert.equal(tokens(s).length, 3);
  assert.equal(s.pendingTriggers.length, 0);
  assert.ok(tokens(s).every((o) => o.tapped && s.combat.attackers.some((r) => r.id === o.id)));
  s.step = 'endCombat';
  notifyTriggers(s, 'step', { player: 0, step: 'endCombat' });
  assert.equal(s.delayedTriggers.length, 1);
  assert.equal(tokens(s).length, 3);
  end(s);
  assert.equal(s.stack.length, 1);
  resolveTop(s);
  assert.equal(tokens(s).length, 0);
  assert.equal(s.delayedTriggers, undefined);
});
test('mobilize delay sacrifices only original incarnations still controlled by its controller', () => {
  const s = fixture();
  const d = put(s, 'Dalkovan Packbeasts');
  attack(s, d);
  resolveTop(s);
  const [a, b, c] = tokens(s);
  a.controller = 1;
  move(s, b, 'exile');
  move(s, b, 'battlefield');
  const unrelated = put(s, 'Mobilized Warrior Token');
  end(s);
  resolveTop(s);
  assert.equal(a.zone, 'battlefield');
  assert.equal(b.zone, 'battlefield');
  assert.equal(c.zone, 'graveyard');
  assert.equal(unrelated.zone, 'battlefield');
  // The one-shot delayed trigger does not retry a missed sacrifice next turn.
  a.controller = 0;
  end(s);
  assert.equal(s.stack.length, 0);
});
test('mobilize X counts creature cards at resolution, not attack declaration', () => {
  const s = fixture();
  const d = put(s, 'Avenger of the Fallen');
  put(s, 'Forest', 0, 'graveyard');
  attack(s, d);
  put(s, 'Llanowar Elves', 0, 'graveyard');
  resolveTop(s);
  assert.equal(tokens(s).length, 1);
});
test('mobilized tokens enter attacking before enters observers and gain the correct anthem', () => {
  const s = fixture();
  const d = put(s, 'Bone-Cairn Butcher');
  attack(s, d);
  resolveTop(s);
  assert.equal(tokens(s).length, 2);
  assert.ok(tokens(s).every((o) => keywords(s, o).includes('deathtouch')));
  const enemy = put(s, 'Mobilized Warrior Token', 1);
  s.combat.attackers.push(ref(enemy));
  assert.ok(!keywords(s, enemy).includes('deathtouch'));
  s.combat.attackers = [];
  assert.ok(tokens(s).every((o) => !keywords(s, o).includes('deathtouch')));
});
test('Vanguard power updates immediately with mobilized tokens', () => {
  const s = fixture();
  const d = put(s, "Zurgo's Vanguard");
  attack(s, d);
  resolveTop(s);
  assert.equal(stats(s, d).power, 2);
  end(s);
  resolveTop(s);
  assert.equal(stats(s, d).power, 1);
});
test('registry rejects missing mobilize token and invalid counts', () => {
  assert.throws(
    () =>
      createRegistry({
        ...CARDS,
        Broken: {
          name: 'Broken',
          type: 'creature',
          cost: {},
          power: 1,
          toughness: 1,
          triggers: [
            {
              event: 'selfAttacks',
              effects: [{ op: 'mobilize', count: 1, definition: 'Missing Token' }],
            },
          ],
        },
      }),
    /missing token/,
  );
  assert.throws(
    () =>
      createRegistry({
        ...CARDS,
        Broken: {
          name: 'Broken',
          type: 'creature',
          cost: {},
          power: 1,
          toughness: 1,
          triggers: [
            {
              event: 'selfAttacks',
              effects: [{ op: 'mobilize', count: -1, definition: 'Mobilized Warrior Token' }],
            },
          ],
        },
      }),
    /count/,
  );
});
test('next-end-step trigger is one-shot even when countered', () => {
  const s = fixture();
  const d = put(s, 'Dragonback Lancer');
  attack(s, d);
  resolveTop(s);
  end(s);
  s.stack.pop();
  end(s);
  assert.equal(s.stack.length, 0);
  assert.equal(tokens(s).length, 1);
});
test('simultaneous mobilize deaths preserve death trigger observations', () => {
  const s = fixture();
  const d = put(s, 'Dalkovan Packbeasts');
  put(s, 'Venerated Stormsinger');
  attack(s, d);
  resolveTop(s);
  end(s);
  resolveTop(s);
  assert.equal(s.pendingTriggers.length, 3);
  assert.ok(s.pendingTriggers.every((t) => t.name === 'Venerated Stormsinger'));
});
test('a delayed mobilize created after the end-step event waits for the following end step', () => {
  const s = fixture();
  const d = put(s, 'Dragonback Lancer');
  attack(s, d);
  s.step = 'end';
  notifyTriggers(s, 'step', { player: 0, step: 'end' });
  resolveTop(s);
  assert.equal(tokens(s).length, 1);
  assert.equal(s.pendingTriggers.length, 0);
  assert.ok(!s.combat.attackers.some((r) => r.id === tokens(s)[0].id));
  s.turn++;
  s.active = 1;
  end(s);
  resolveTop(s);
  assert.equal(tokens(s).length, 0);
});
test('mobilize rejects tokens with unsupported pausing entry choices', () => {
  assert.throws(
    () =>
      createRegistry({
        ...CARDS,
        'Choice Token': {
          name: 'Choice Token',
          type: 'creature',
          cost: {},
          token: true,
          power: 1,
          toughness: 1,
          chooseCreatureType: true,
        },
        Broken: {
          name: 'Broken',
          type: 'creature',
          cost: {},
          power: 1,
          toughness: 1,
          triggers: [
            {
              event: 'selfAttacks',
              effects: [{ op: 'mobilize', count: 1, definition: 'Choice Token' }],
            },
          ],
        },
      }),
    /without entry choices/,
  );
});
