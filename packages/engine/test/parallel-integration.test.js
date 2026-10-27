import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';

test('typecycling searches recognize changeling creature types in the library', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Wizardcycling fixture': {
      name: 'Wizardcycling fixture',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      cycling: {},
      cyclingType: 'Wizard',
    },
  });
  const cycler = put(s, 'Wizardcycling fixture', 0, 'hand');
  const changeling = put(s, 'Chitinous Graspling', 0, 'library');
  s = act(s, 'cycle', { card: cycler.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(s.choice.cards.includes(changeling.id));
  s = act(s, 'searchLibrary', { cards: [changeling.id] });
  assert.equal(s.objects[changeling.id].zone, 'hand');
});

test('second-spell predicates see chosen-X stack mana value without storing it as hidden history', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'First cast fixture': { name: 'First cast fixture', type: 'instant', cost: {}, effects: [] },
    'Ordinal mana witness': {
      name: 'Ordinal mana witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: {
            event: 'cast',
            controller: 'you',
            spellNumber: 2,
            filter: { manaValue: { gte: 5 } },
          },
          effects: [{ op: 'gainLife', amount: 2 }],
        },
      ],
    },
  });
  put(s, 'Ordinal mana witness');
  const first = put(s, 'First cast fixture', 0, 'hand');
  s = act(s, 'cast', { card: first.id });
  s = resolve(s);
  for (let i = 0; i < 5; i++) put(s, 'Island');
  const spring = put(s, 'Mind Spring', 0, 'hand');
  s = act(s, 'cast', { card: spring.id, x: 3 });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(JSON.stringify(s.players[0].spellsCast).includes('Mind Spring'), false);
});

import { dispatch } from '../src/index.js';
import { nextTurn } from '../src/turn.js';
test('plot special-action costs cannot convoke, while later casting can convoke only actual taxes', () => {
  for (const taxed of [false, true]) {
    let s = fixture();
    s.catalog = createRegistry({
      ...CARDS,
      'Plotted convoke fixture': {
        name: 'Plotted convoke fixture',
        type: 'instant',
        cost: { generic: 5 },
        plot: { generic: 2 },
        keywords: ['convoke'],
        effects: [],
      },
    });
    const card = put(s, 'Plotted convoke fixture', 0, 'hand'),
      creature = put(s, 'Grizzly Bears');
    assert.equal(dispatch(s, { type: 'plot', player: 0, card: card.id }).ok, false);
    s.players[0].mana.U = 2;
    s = act(s, 'plot', { card: card.id });
    assert.equal(s.objects[creature.id].tapped, false);
    nextTurn(s);
    nextTurn(s);
    s.step = 'main1';
    if (taxed) put(s, 'Thalia, the Survivor', 1);
    const payment = [{ card: creature.id, symbol: 'generic' }];
    if (!taxed)
      assert.equal(
        dispatch(s, { type: 'cast', player: 0, card: card.id, convoke: payment }).ok,
        false,
      );
    s = act(s, 'cast', { card: card.id, convoke: taxed ? payment : [] });
    assert.equal(s.objects[creature.id].tapped, taxed);
    assert.equal(s.objects[card.id].zone, 'stack');
  }
});

test('mana availability is evaluated after the proposed spell leaves hand', () => {
  for (const operator of ['eq', 'gte']) {
    let s = fixture();
    s.catalog = createRegistry({
      ...CARDS,
      'Hand conditional land': {
        name: 'Hand conditional land',
        type: 'land',
        cost: {},
        mana: ['G'],
        manaConditions: {
          G: {
            kind: 'compare',
            left: { kind: 'count', zone: 'hand', player: 'you' },
            right: operator === 'eq' ? 0 : 1,
            operator,
          },
        },
      },
      'Hand payment spell': {
        name: 'Hand payment spell',
        type: 'sorcery',
        cost: { G: 1 },
        effects: [],
      },
    });
    put(s, 'Hand conditional land');
    const card = put(s, 'Hand payment spell', 0, 'hand');
    const before = structuredClone(s);
    const result = dispatch(s, { type: 'cast', player: 0, card: card.id });
    assert.equal(result.ok, operator === 'eq');
    assert.deepEqual(s, before);
  }
});

import { ref } from '../src/index.js';
test('a friendly targeted trigger is retained when its creature pays the casting sacrifice cost', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Target sacrifice fixture': {
      name: 'Target sacrifice fixture',
      type: 'instant',
      cost: {},
      target: 'creature',
      sacrificeCost: { where: { type: 'creature' } },
      effects: [],
    },
  });
  const creature = put(s, 'Emberheart Challenger'),
    spell = put(s, 'Target sacrifice fixture', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(creature), sacrifice: ref(creature) });
  assert.equal(s.objects[creature.id].zone, 'graveyard');
  assert.equal(s.stack.length, 2);
  const triggered = s.events.findIndex((e) => e.type === 'triggered' && e.objectId === creature.id);
  const departed = s.events.findIndex(
    (e) => e.type === 'zoneChange' && e.objectId === creature.id && e.to === 'graveyard',
  );
  assert.ok(triggered >= 0 && departed > triggered);
  s = resolve(s);
  assert.equal(s.choice.kind, 'exilePlay');
  assert.equal(s.choice.cards.length, 1);
});
