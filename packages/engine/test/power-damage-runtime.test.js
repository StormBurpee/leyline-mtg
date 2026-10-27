import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry } from '../src/index.js';
import { move, ref } from '../src/model.js';
import { fixture, put, act, resolve } from './helpers.js';
const setup = (op, victimSelector = 'creature') => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Bound damage fixture': {
      name: 'Bound damage fixture',
      type: 'creature',
      cost: {},
      power: 3,
      toughness: 3,
      activated: [
        {
          cost: {},
          targetGroups: [{ id: 'victim', selector: victimSelector, min: 0, max: 1 }],
          effects: [{ op, source: 'source', victimGroup: 'victim' }],
        },
      ],
    },
  });
  return { s, actor: put(s, 'Bound damage fixture'), victim: put(s, 'Grizzly Bears', 1) };
};
test('explicit source fight requires two current creatures and never uses a returned incarnation', () => {
  for (const failure of [
    'none',
    'sourceGone',
    'sourceReturned',
    'sourceNotCreature',
    'victimGone',
    'victimReturned',
    'victimNotCreature',
  ]) {
    let { s, actor, victim } = setup('fight');
    s = act(s, 'activate', { card: actor.id, ability: 0, targets: { victim: [ref(victim)] } });
    const chosen = s.objects[failure.startsWith('source') ? actor.id : victim.id];
    if (failure.endsWith('NotCreature')) chosen.definitionOverride = CARDS.Forest;
    else if (failure !== 'none') {
      move(s, chosen, 'hand');
      if (failure.endsWith('Returned')) move(s, chosen, 'battlefield');
    }
    s = resolve(s);
    const packets = s.events.filter((e) => e.type === 'damage');
    assert.equal(packets.length, failure === 'none' ? 2 : 0, failure);
    if (failure === 'none') {
      assert.equal(s.objects[victim.id].zone, 'graveyard');
      assert.equal(s.objects[actor.id].damage, 2);
    }
  }
});
test('explicit source bite uses departure LKI for power, deathtouch and lifelink', () => {
  let { s, actor, victim } = setup('bite');
  s.objects[victim.id].plusCounters = 10;
  const collar = put(s, 'Basilisk Collar');
  collar.attachedTo = ref(actor);
  s = act(s, 'activate', { card: actor.id, ability: 0, targets: { victim: [ref(victim)] } });
  s.objects[actor.id].plusCounters = 2;
  move(s, s.objects[actor.id], 'hand');
  move(s, s.objects[actor.id], 'battlefield');
  s.objects[actor.id].plusCounters = 40;
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 25);
  assert.equal(s.events.filter((e) => e.type === 'damage').at(-1).amount, 5);
});
test('explicit source bite can damage planeswalkers but an absent optional victim deals nothing', () => {
  let { s, actor } = setup('bite', { scope: 'permanent', where: { type: 'planeswalker' } });
  const walker = put(s, 'Jace Token', 1);
  walker.loyalty = 6;
  s = act(s, 'activate', { card: actor.id, ability: 0, targets: { victim: [ref(walker)] } });
  s = resolve(s);
  assert.equal(s.objects[walker.id].loyalty, 3);
  s = act(s, 'activate', { card: actor.id, ability: 0, targets: { victim: [] } });
  s = resolve(s);
  assert.equal(s.objects[walker.id].loyalty, 3);
});
