import test from 'node:test';
import assert from 'node:assert/strict';
import { ref, keywords } from '../src/index.js';
import { definition, move } from '../src/model.js';
import { resolveEffects } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const apply = (s, source, target, effects) =>
  resolveEffects(s, {
    controller: source.controller,
    source: ref(source),
    target: ref(target),
    effects,
  });

test('Captain power-up keyword counter respects earlier and later Wasp ability-loss timestamps', () => {
  const s = fixture(),
    captain = put(s, "Captain Marvel, Earth's Protector"),
    wasp = put(s, 'The Wondrous Wasp', 1);
  const counters = [
    { op: 'keywordCounter', subject: 'source', keyword: 'indestructible', amount: 1 },
  ];
  apply(s, captain, captain, counters);
  assert.ok(keywords(s, captain).includes('indestructible'));
  apply(s, wasp, captain, [{ op: 'removeAbilities', until: 'sourceLeaves' }]);
  assert.equal(keywords(s, captain).includes('indestructible'), false);
  apply(s, captain, captain, counters);
  assert.ok(keywords(s, captain).includes('indestructible'));
});

test('Hamlet grants mana after ability loss and its own removal restores the stripped state', () => {
  const s = fixture(),
    hamlet = put(s, 'Petrified Hamlet'),
    sanctuary = put(s, 'Soulstone Sanctuary'),
    wasp = put(s, 'The Wondrous Wasp', 1);
  hamlet.chosenLandName = sanctuary.name;
  apply(s, wasp, sanctuary, [{ op: 'removeAbilities', until: 'sourceLeaves' }]);
  assert.deepEqual(definition(s, sanctuary).mana, ['C']);
  assert.equal(definition(s, sanctuary).activated, undefined);
  move(s, hamlet, 'graveyard');
  assert.equal(definition(s, sanctuary).mana, undefined);
});

test('Earthbend follows Rest in Peace replacement to exile and returns the exact land incarnation', () => {
  let s = fixture();
  const land = put(s, 'Forest'),
    ascension = put(s, 'Earthbender Ascension');
  put(s, 'Rest in Peace');
  apply(s, ascension, land, [{ op: 'earthbend', amount: 2 }]);
  const before = land.incarnation;
  move(s, land, 'graveyard');
  assert.equal(land.zone, 'exile');
  assert.equal(land.incarnation, before + 1);
  assert.equal(s.pendingTriggers.filter((t) => t.rule === 'earthbendReturn').length, 1);
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].tapped, true);
  assert.equal(s.objects[land.id].incarnation, before + 2);
});

test('Erode optional search decline never triggers opposing Wan; accepted zero-card search does', () => {
  const setup = () => {
    let s = fixture();
    lands(s, 'Plains', 1);
    const wan = put(s, 'Wan Shi Tong, Librarian'),
      elf = put(s, 'Llanowar Elves', 1),
      erode = put(s, 'Erode', 0, 'hand');
    s = act(s, 'cast', { card: erode.id, target: ref(elf) });
    s = resolve(s);
    return { s, wan };
  };
  let { s, wan } = setup();
  const library = [...s.players[1].library],
    hand = s.players[0].hand.length;
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  s = resolve(s);
  assert.deepEqual(s.players[1].library, library);
  assert.equal(s.players[0].hand.length, hand);
  ({ s, wan } = setup());
  const previous = s.players[0].hand.length;
  s = act(s, 'searchLibrary', { cards: [] });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, previous + 1);
});
