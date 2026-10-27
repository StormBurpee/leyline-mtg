import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasKeyword,
  stats,
  CARDS,
  CARD_IDS,
  cyclingProblem,
  legalActions,
  dispatch,
  chooseBotCommand,
  validateDefinition,
  createRegistry,
} from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { move } from '../src/model.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';

const names = Object.keys(CARDS).filter((name) => CARDS[name].cyclingType);
test('all 23 complete landcyclers validate and round-trip through source compilation', () => {
  assert.equal(names.length, 23);
  for (const name of names) {
    const d = CARDS[name];
    assert.deepEqual(validateDefinition(d), [], name);
    const compiled = compileCard(
      sourceFromDefinition(d, {
        id: Object.keys(CARD_IDS).find((id) => CARD_IDS[id] === name),
        idsByName: Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id])),
      }),
      { identities: CARD_IDS },
    );
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(canonical(compiled.definition), canonical(d), name);
  }
});
for (const name of names)
  test(`${name}: pays and discards before an optional revealed search, never casts`, () => {
    let s = fixture();
    const card = put(s, name, 0, 'hand');
    lands(s, 'Forest', 2);
    lands(s, 'Island', 2);
    for (const basic of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
      put(s, basic, 0, 'library');
    const life = s.players[0].life;
    assert.equal(cyclingProblem(s, 0, card.id), null);
    s = act(s, 'cycle', { card: card.id });
    assert.equal(s.objects[card.id].zone, 'graveyard');
    assert.equal(s.stack.length, 1);
    assert.equal(s.stack[0].kind, 'ability');
    assert.equal(s.choice, null);
    assert.equal(s.players[0].life, life); // No enters/dies trigger from a discarded creature.
    assert.equal(s.events.filter((e) => e.type === 'cast').length, 0);
    assert.equal(
      Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.tapped).length,
      2,
    );
    assert.ok(!legalActions(s, 0).some((a) => a.type === 'cycle' && a.card === card.id));
    s = resolve(s);
    assert.equal(s.choice.kind, 'librarySearch');
    assert.equal(s.choice.min, 0);
    assert.equal(s.choice.max, 1);
    assert.equal(s.choice.reveal, true);
    const chosen = s.choice.cards[0];
    assert.ok(chosen);
    s = act(s, 'searchLibrary', { cards: [chosen] });
    assert.equal(s.objects[chosen].zone, 'hand');
    assert.equal(s.objects[card.id].zone, 'graveyard');
    assert.equal(s.choice, null);
    assert.equal(s.resolving, null);
    assert.equal(s.stack.length, 0);
    assert.ok(s.events.some((e) => e.type === 'libraryShuffled'));
    assert.ok(
      s.events.some(
        (e) => e.type === 'librarySearched' && e.revealed?.includes(s.objects[chosen].name),
      ),
    );
  });
test('Forestcycling finds nonbasic Forests but basic landcycling does not', () => {
  const dual = { ...CARDS.Forest, name: 'Test dual', basic: false, subtypes: ['Forest', 'Island'] };
  for (const [name, findsDual] of [
    ['Slavering Branchsnapper', true],
    ['Topiary Panther', false],
  ]) {
    let s = fixture();
    s.catalog = createRegistry([...Object.values(CARDS), dual]);
    const card = put(s, name, 0, 'hand'),
      nonbasic = put(s, dual.name, 0, 'library');
    lands(s, 'Forest', 2);
    s = resolve(act(s, 'cycle', { card: card.id }));
    assert.equal(s.choice.cards.includes(nonbasic.id), findsDual);
    assert.ok(
      s.choice.cards.every((id) =>
        findsDual
          ? s.catalog[s.objects[id].name].subtypes.includes('Forest')
          : s.catalog[s.objects[id].name].basic,
      ),
    );
    s = act(s, 'searchLibrary', { cards: [] });
    assert.equal(s.choice, null);
    assert.equal(s.objects[nonbasic.id].zone, 'library');
  }
});
test('cycling rejects wrong player, battlefield, insufficient mana, and stale repeated activation', () => {
  let s = fixture();
  const c = put(s, 'Topiary Panther', 0, 'hand');
  lands(s, 'Island', 2);
  assert.match(cyclingProblem(s, 0, c.id), /mana/);
  assert.match(cyclingProblem(s, 1, c.id), /hand/);
  lands(s, 'Forest', 1);
  const battlefield = put(s, 'Topiary Panther');
  assert.match(cyclingProblem(s, 0, battlefield.id), /hand/);
  s = act(s, 'cycle', { card: c.id });
  assert.equal(dispatch(s, { type: 'cycle', player: 0, card: c.id }).ok, false);
});
test('empty and failed-to-find searches shuffle and finish, and invalid choices can be retried', () => {
  for (const empty of [false, true]) {
    let s = fixture();
    const c = put(s, 'Bedhead Beastie', 0, 'hand');
    lands(s, 'Forest', 2);
    if (empty) for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
    else put(s, 'Mountain', 0, 'library');
    s = resolve(act(s, 'cycle', { card: c.id }));
    assert.equal(dispatch(s, { type: 'searchLibrary', player: 0, cards: [c.id] }).ok, false);
    s = act(s, 'searchLibrary', { cards: [] });
    assert.equal(s.choice, null);
    assert.ok(s.events.some((e) => e.type === 'libraryShuffled'));
  }
});
test('bot cycles to develop mana and completes the search', () => {
  let s = fixture();
  const card = put(s, 'Topiary Panther', 0, 'hand');
  lands(s, 'Forest', 2);
  put(s, 'Mountain', 0, 'library');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'cycle');
  assert.equal(command.card, card.id);
  s = resolve(act(s, 'cycle', { card: card.id }));
  const search = chooseBotCommand(s, 0);
  assert.equal(search.type, 'searchLibrary');
  assert.equal(search.cards.length, 1);
  assert.equal(dispatch(s, search).ok, true);
});

test('typecycling can search a creature subtype without requiring a land', () => {
  let s = fixture();
  const cycler = { ...CARDS['Bedhead Beastie'], name: 'Wizardcycler', cyclingType: 'Wizard' };
  s.catalog = createRegistry([...Object.values(CARDS), cycler]);
  const card = put(s, cycler.name, 0, 'hand');
  const wizard = Object.values(CARDS).find(
    (d) => d.type === 'creature' && d.subtypes?.includes('Wizard'),
  );
  const found = put(s, wizard.name, 0, 'library');
  lands(s, 'Forest', 2);
  s = resolve(act(s, 'cycle', { card: card.id }));
  assert.ok(s.choice.cards.includes(found.id));
  assert.ok(
    s.choice.cards.every((id) => s.catalog[s.objects[id].name].subtypes.includes('Wizard')),
  );
});
test('native and source validators reject malformed typecycling and duplicate cycling abilities', () => {
  for (const cyclingType of ['', '<script>', 3, null])
    assert.ok(validateDefinition({ ...CARDS['Bedhead Beastie'], cyclingType }).length);
  const { cycling, ...withoutCost } = CARDS['Bedhead Beastie'];
  assert.ok(validateDefinition(withoutCost).length);
  const source = sourceFromDefinition(CARDS['Bedhead Beastie'], { id: 'test:cycle' });
  source.abilities.push({ kind: 'cycling', cost: '{1}', type: 'Forest' });
  assert.equal(compileCard(source).ok, false);
});
test('ordinary cycling retains draw behavior', () => {
  let s = fixture();
  const card = put(s, 'Migrating Ketradon', 0, 'hand');
  lands(s, 'Forest', 2);
  s = resolve(act(s, 'cycle', { card: card.id }));
  assert.equal(s.choice, null);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[0].life, 20);
});

function castCreature(name, setup = () => {}) {
  let s = fixture();
  for (const land of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) lands(s, land, 8);
  setup(s);
  const card = put(s, name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  return { s, card };
}
test('life-gain landcyclers retain their real enters and dies abilities', () => {
  for (const [name, amount] of [
    ['Apex Witchstalker', 2],
    ['Balamb T-Rexaur', 3],
    ['Soaring Sandwing', 3],
  ]) {
    let { s, card } = castCreature(name);
    s = resolve(s);
    assert.equal(s.players[0].life, 20 + amount);
    if (name === 'Apex Witchstalker') {
      move(s, s.objects[card.id], 'graveyard');
      // Dispatch flushes the death trigger before its two priority passes.
      s = act(s, 'pass');
      while (s.stack.length) s = act(s, 'pass');
      assert.equal(s.players[0].life, 24);
    }
  }
});
test('Canyon Crawler and Jennika make their exact Food and Mutant tokens', () => {
  for (const [name, token] of [
    ['Canyon Crawler', 'Food Token'],
    ['Jennika, Bad Apple Big Sister', 'Mutant Token'],
  ]) {
    let { s } = castCreature(name);
    s = resolve(s);
    assert.ok(
      Object.values(s.objects).some(
        (o) => o.name === token && o.zone === 'battlefield' && o.controller === 0,
      ),
    );
  }
});
test('targeted landcycler enters abilities preserve counters, restrictions, and temporary keywords', () => {
  for (const [name, counter, power, keyword] of [
    ['Cloudbound Moogle', 1, 2, null],
    ['Vinelasher Adept', 3, 2, null],
    ['Rampaging Spiketail', 0, 4, 'indestructible'],
    ['Stratosoarer', 0, 2, 'flying'],
  ]) {
    let target;
    let { s } = castCreature(name, (state) => {
      target = put(state, 'Grizzly Bears');
    });
    assert.equal(s.choice.kind, 'triggerTarget');
    s = act(s, 'chooseTriggerTarget', {
      target: { kind: 'object', id: target.id, incarnation: target.incarnation },
    });
    s = resolve(s);
    assert.equal(s.objects[target.id].plusCounters, counter);
    assert.equal(stats(s, s.objects[target.id]).power, power + counter);
    if (keyword) assert.ok(hasKeyword(s, s.objects[target.id], keyword));
  }
});
test('Ice Flan only targets opposing artifacts or creatures and adds a stun counter', () => {
  let target;
  let { s } = castCreature('Ice Flan', (state) => {
    target = put(state, 'Grizzly Bears', 1);
  });
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.ok(s.choice.targets.every((t) => s.objects[t.id].controller === 1));
  s = act(s, 'chooseTriggerTarget', {
    target: { kind: 'object', id: target.id, incarnation: target.incarnation },
  });
  s = resolve(s);
  assert.equal(s.objects[target.id].tapped, true);
  assert.equal(s.objects[target.id].stunCounters, 1);
});
test('Stockman draws then pauses to discard, without flattening its ETB into a draw', () => {
  let { s } = castCreature('Stockman, Mad Fly-entist');
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 1);
  const discard = s.players[0].hand[0];
  s = act(s, 'discardEffect', { cards: [discard] });
  assert.equal(s.objects[discard].zone, 'graveyard');
});
test('Bebop grants menace only to controlled Rhinos and Undulating Witness retains its pump', () => {
  let s = fixture();
  put(s, 'Bebop, Warthog Warrior');
  const yours = put(s, 'Vinelasher Adept'),
    theirs = put(s, 'Vinelasher Adept', 1),
    bear = put(s, 'Grizzly Bears');
  assert.ok(hasKeyword(s, yours, 'menace'));
  assert.equal(hasKeyword(s, theirs, 'menace'), false);
  assert.equal(hasKeyword(s, bear, 'menace'), false);
  const witness = put(s, 'Undulating Witness');
  lands(s, 'Forest', 2);
  s = resolve(act(s, 'activate', { card: witness.id, ability: 0 }));
  assert.deepEqual(stats(s, s.objects[witness.id]), { power: 4, toughness: 4 });
});
test('spell-only counters cannot target a typecycling ability', () => {
  let s = fixture();
  const card = put(s, 'Bedhead Beastie', 0, 'hand');
  lands(s, 'Forest', 2);
  lands(s, 'Island', 3, 1);
  const negate = put(s, 'Negate', 1, 'hand');
  s = act(s, 'cycle', { card: card.id });
  s = act(s, 'pass');
  assert.equal(s.priority, 1);
  assert.ok(!legalActions(s, 1).some((a) => a.type === 'cast' && a.card === negate.id));
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 1,
      card: negate.id,
      target: { kind: 'stack', id: s.stack[0].id },
    }).ok,
    false,
  );
});
