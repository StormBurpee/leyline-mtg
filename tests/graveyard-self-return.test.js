import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  legalActions,
  chooseBotCommand,
  exportReplay,
  replay,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import { dealDamage, stabilize } from '../packages/engine/src/effects.js';
import {
  fixture as baseFixture,
  put,
  lands,
  act,
  resolve,
} from '../packages/engine/test/helpers.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';

const names = [
  'Reassembling Skeleton',
  'Blessed Ghoul',
  'Bestial Bloodline',
  'Merchant of Many Hats',
  'Project Deathlok Soldier',
  'Tunnel Rats',
  'Summoned Dromedary',
];
const sources = names.map((name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
        import.meta.url,
      ),
    ),
  ),
);
const definitions = Object.fromEntries(
  sources.map((source) => {
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    return [source.name, result.definition];
  }),
);
const catalog = createRegistry({ ...CARDS, ...definitions });
function fixture(extra = {}) {
  const s = baseFixture();
  s.catalog = Object.keys(extra).length ? createRegistry({ ...catalog, ...extra }) : catalog;
  return s;
}
function rejection(s, command) {
  const before = structuredClone(s);
  const result = dispatch(s, { type: 'activate', player: 0, ability: 0, ...command });
  assert.equal(result.ok, false);
  assert.deepEqual(s, before, 'illegal activation must not spend resources or mutate input');
  return result;
}
function manaFor(s, name, multiplier = 1) {
  const mana = definitions[name].activated[0].cost.mana;
  const land = mana.G ? 'Forest' : mana.W ? 'Plains' : 'Swamp';
  return lands(s, land, Object.values(mana).reduce((sum, n) => sum + n, 0) * multiplier);
}
const isActivation = (a, id) => a.type === 'activate' && a.card === id;

test('seven complete graveyard return sources validate, compile, and round trip without fake exile costs', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    JSON.parse(readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url))),
  );
  for (const source of sources) {
    assert.equal(validate(source), true, source.name + JSON.stringify(validate.errors));
    const d = definitions[source.name];
    assert.equal(d.text, source.rulesText);
    assert.equal(d.activated[0].zone, 'graveyard');
    assert.equal(d.activated[0].cost.exileSelf, undefined);
    assert.equal(d.activated[0].target, undefined, 'self-return is not a target');
    const round = compileCard(sourceFromDefinition(d, { id: source.id }));
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, d);
  }
  assert.deepEqual(definitions['Project Deathlok Soldier'].types, ['artifact', 'creature']);
});

for (const name of names) {
  test(`${name}: owner pays real mana, source remains in graveyard until resolution, then returns once`, () => {
    let s = fixture();
    const mana = manaFor(s, name);
    const source = put(s, name, 0, 'graveyard');
    s.objects[source.id].controller = 1; // A former battlefield controller has no authority here.
    if (name !== 'Summoned Dromedary') {
      s.active = 1;
      s.step = 'end';
    }
    const before = ref(source);
    const action = legalActions(s, 0).find((a) => isActivation(a, source.id));
    assert.ok(action);
    s = act(s, 'activate', action);
    assert.equal(s.objects[source.id].zone, 'graveyard');
    assert.equal(s.objects[source.id].incarnation, before.incarnation);
    assert.ok(mana.every((o) => s.objects[o.id].tapped));
    assert.equal(s.stack.at(-1).controller, 0);
    assert.deepEqual(s.stack.at(-1).source, before);
    assert.equal(s.stack.at(-1).target, null);
    assert.ok(!s.events.some((e) => e.type === 'exiledAsCost'));
    s = resolve(s);
    const effect = definitions[name].activated[0].effects[0];
    assert.equal(s.objects[source.id].zone, effect.destination);
    assert.ok(s.objects[source.id].incarnation > before.incarnation);
    if (effect.destination === 'battlefield') {
      assert.equal(s.objects[source.id].tapped, true);
      assert.equal(s.objects[source.id].controller, 0);
    } else assert.ok(s.players[0].hand.includes(source.id));
    assert.ok(!legalActions(s, 0).some((a) => isActivation(a, source.id)));
  });
}

test('source-zone, owner, priority, timing, mana, and nonexistent target failures are atomic', () => {
  for (const zone of ['battlefield', 'hand', 'library', 'exile']) {
    const s = fixture();
    manaFor(s, 'Reassembling Skeleton');
    const card = put(s, 'Reassembling Skeleton', 0, zone);
    rejection(s, { card: card.id });
    assert.ok(!legalActions(s, 0).some((a) => isActivation(a, card.id)));
  }
  for (const scenario of ['opponent', 'priority', 'mana', 'target', 'targetGroups', 'ability']) {
    const s = fixture();
    if (scenario !== 'mana') manaFor(s, 'Reassembling Skeleton');
    const card = put(s, 'Reassembling Skeleton', scenario === 'opponent' ? 1 : 0, 'graveyard');
    if (scenario === 'opponent') card.controller = 0;
    if (scenario === 'priority') s.priority = 1;
    rejection(s, {
      card: card.id,
      ...(scenario === 'target' ? { target: ref(card) } : {}),
      ...(scenario === 'targetGroups' ? { targets: { chosen: [ref(card)] } } : {}),
      ...(scenario === 'ability' ? { ability: 1 } : {}),
    });
  }
});

test('Summoned Dromedary requires its owner main phase and an empty stack but retains vigilance', () => {
  for (const scenario of ['opponentTurn', 'combat', 'stack']) {
    const s = fixture();
    manaFor(s, 'Summoned Dromedary');
    const card = put(s, 'Summoned Dromedary', 0, 'graveyard');
    if (scenario === 'opponentTurn') s.active = 1;
    if (scenario === 'combat') s.step = 'beginCombat';
    if (scenario === 'stack') s.stack.push({ id: 'pending', kind: 'ability', effects: [] });
    rejection(s, { card: card.id });
    assert.ok(!legalActions(s, 0).some((a) => isActivation(a, card.id)));
  }
  let s = fixture();
  lands(s, 'Plains', 4);
  const card = put(s, 'Summoned Dromedary', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'battlefield');
  assert.ok(hasKeyword(s, s.objects[card.id], 'vigilance'));
});

test('source return does not follow a card exiled or removed and put back in the graveyard', () => {
  for (const name of ['Reassembling Skeleton', 'Merchant of Many Hats']) {
    for (const returnToGraveyard of [false, true]) {
      let s = fixture();
      manaFor(s, name);
      const card = put(s, name, 0, 'graveyard');
      s = act(s, 'activate', { card: card.id, ability: 0 });
      move(s, s.objects[card.id], 'exile');
      if (returnToGraveyard) move(s, s.objects[card.id], 'graveyard');
      const newer = ref(s.objects[card.id]);
      s = resolve(s);
      assert.equal(s.objects[card.id].zone, returnToGraveyard ? 'graveyard' : 'exile');
      assert.deepEqual(ref(s.objects[card.id]), newer);
      assert.equal(s.stack.length, 0);
    }
  }
});

test('repeated activations are legal, but older return cannot affect a new graveyard incarnation', () => {
  let s = fixture();
  manaFor(s, 'Reassembling Skeleton', 3);
  const card = put(s, 'Reassembling Skeleton', 0, 'graveyard');
  for (let i = 0; i < 2; i++) s = act(s, 'activate', { card: card.id, ability: 0 });
  assert.equal(s.stack.length, 2);
  assert.equal(s.objects[card.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'battlefield');
  move(s, s.objects[card.id], 'graveyard');
  const newer = ref(s.objects[card.id]);
  s = resolve(s);
  assert.deepEqual(ref(s.objects[card.id]), newer);
  assert.equal(s.objects[card.id].zone, 'graveyard');
  s = act(s, 'activate', { card: card.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'battlefield');
  assert.ok(s.objects[card.id].incarnation > newer.incarnation);
});

test('countering the return ability leaves the graveyard card available for another activation', () => {
  let s = fixture();
  manaFor(s, 'Reassembling Skeleton', 2);
  lands(s, 'Island', 3, 1);
  const source = put(s, 'Reassembling Skeleton', 0, 'graveyard');
  const tidebinder = put(s, "Tishana's Tidebinder", 1, 'hand');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  const ability = s.stack.at(-1).id;
  s = act(s, 'pass');
  s = act(s, 'cast', { card: tidebinder.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [{ kind: 'stack', id: ability }] } });
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.ok(legalActions(s, 0).some((a) => isActivation(a, source.id)));
  s = act(s, 'activate', { card: source.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[source.id].zone, 'battlefield');
});

test('return to battlefield uses ordinary entry processing and triggers', () => {
  let s = fixture();
  manaFor(s, 'Reassembling Skeleton');
  put(s, 'Soul Warden');
  const source = put(s, 'Reassembling Skeleton', 0, 'graveyard');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.stack.at(-1).name, 'Soul Warden');
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
});

test('Blessed Ghoul uses either hybrid color for casting and returning and keeps lifelink', () => {
  for (const land of ['Plains', 'Swamp']) {
    let s = fixture();
    lands(s, land, 4);
    const card = put(s, 'Blessed Ghoul', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    s = resolve(s);
    assert.ok(hasKeyword(s, s.objects[card.id], 'lifelink'));
    dealDamage(
      s,
      { ...ref(s.objects[card.id]), controller: 0, keywords: ['lifelink'] },
      { kind: 'player', id: 1 },
      1,
    );
    assert.equal(s.players[0].life, 21);
    move(s, s.objects[card.id], 'graveyard');
    s = act(s, 'activate', { card: card.id, ability: 0 });
    s = resolve(s);
    assert.equal(s.objects[card.id].zone, 'hand');
  }
});

test('Bestial Bloodline enchants either player creature, grants +2/+2, falls off, and returns to hand', () => {
  for (const owner of [0, 1]) {
    let s = fixture();
    lands(s, 'Forest', 7);
    const creature = put(s, 'Grizzly Bears', owner);
    const aura = put(s, 'Bestial Bloodline', 0, 'hand');
    s = act(s, 'cast', { card: aura.id, target: ref(creature) });
    s = resolve(s);
    assert.deepEqual(stats(s, s.objects[creature.id]), { power: 4, toughness: 4 });
    assert.equal(s.objects[aura.id].attachedTo.id, creature.id);
    move(s, s.objects[creature.id], 'hand');
    stabilize(s);
    assert.equal(s.objects[aura.id].zone, 'graveyard');
    s = act(s, 'activate', { card: aura.id, ability: 0 });
    s = resolve(s);
    assert.equal(s.objects[aura.id].zone, 'hand');
    assert.equal(s.objects[aura.id].attachedTo, null);
  }
});

test('generic non-exiling graveyard activations preserve declared targets and payment costs', () => {
  const name = 'Graveyard recovery fixture';
  const card = {
    name,
    type: 'creature',
    cost: {},
    power: 1,
    toughness: 1,
    activated: [
      {
        zone: 'graveyard',
        cost: { mana: { B: 1 }, life: 2, discard: 1 },
        target: {
          scope: 'graveyard',
          where: { all: [{ type: 'creature' }, { owner: 'you' }] },
          excludeSource: true,
        },
        effects: [{ op: 'moveTarget', destination: 'hand' }],
      },
    ],
  };
  let s = fixture({ [name]: card });
  lands(s, 'Swamp', 1);
  const source = put(s, name, 0, 'graveyard');
  const target = put(s, 'Grizzly Bears', 0, 'graveyard');
  const discard = put(s, 'Forest', 0, 'hand');
  const opposing = put(s, 'Grizzly Bears', 1, 'graveyard');
  const wrongDiscard = put(s, 'Forest', 1, 'hand');
  rejection(s, { card: source.id, target: ref(opposing), discardCard: discard.id });
  rejection(s, { card: source.id, target: ref(target), discardCard: wrongDiscard.id });
  s.players[0].life = 1;
  rejection(s, { card: source.id, target: ref(target), discardCard: discard.id });
  s.players[0].life = 20;
  rejection(s, { card: source.id, target: ref(source), discardCard: discard.id });
  rejection(s, { card: source.id, target: ref(target) });
  s = act(s, 'activate', {
    card: source.id,
    ability: 0,
    target: ref(target),
    discardCard: discard.id,
  });
  assert.equal(s.players[0].life, 18);
  assert.equal(s.objects[discard.id].zone, 'graveyard');
  assert.equal(s.objects[source.id].zone, 'graveyard');
  move(s, s.objects[source.id], 'exile'); // Independent effect still resolves after source leaves.
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'hand');
});

test('graveyard activated target groups remain required and stale targets are rechecked on resolution', () => {
  const name = 'Grouped graveyard recovery fixture';
  const d = {
    ...definitions['Reassembling Skeleton'],
    name,
    activated: [
      {
        zone: 'graveyard',
        cost: { mana: { B: 1 } },
        targetGroups: [
          {
            id: 'chosen',
            selector: {
              scope: 'graveyard',
              where: { all: [{ type: 'creature' }, { owner: 'you' }] },
              excludeSource: true,
            },
            min: 1,
            max: 1,
          },
        ],
        effects: [{ op: 'moveTarget', targetGroup: 'chosen', destination: 'hand' }],
      },
    ],
  };
  let s = fixture({ [name]: d });
  lands(s, 'Swamp', 1);
  const source = put(s, name, 0, 'graveyard');
  const target = put(s, 'Grizzly Bears', 0, 'graveyard');
  rejection(s, { card: source.id });
  rejection(s, { card: source.id, targets: { chosen: [ref(source)] } });
  const action = legalActions(s, 0).find((a) => isActivation(a, source.id));
  assert.deepEqual(action.targets, { chosen: [ref(target)] });
  s = act(s, 'activate', action);
  move(s, s.objects[target.id], 'hand');
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.objects[target.id].zone, 'graveyard');
});

test('graveyard validation allows real optional exile and zero costs, but rejects impossible source costs and zones', () => {
  const base = definitions['Reassembling Skeleton'];
  for (const cost of [{}, { mana: { B: 1 } }, { exileSelf: true }])
    assert.doesNotThrow(() =>
      createRegistry([{ ...base, activated: [{ ...base.activated[0], cost }] }]),
    );
  for (const ability of [
    { ...base.activated[0], zone: 'exile' },
    { ...base.activated[0], cost: { tap: true } },
    { ...base.activated[0], cost: { sacrificeSelf: true } },
    { ...base.activated[0], cost: { exileSelf: 'yes' } },
    { ...base.activated[0], zone: undefined, cost: { exileSelf: true } },
    { ...base.activated[0], timing: 'instant' },
  ])
    assert.throws(() => createRegistry([{ ...base, activated: [ability] }]));
  assert.throws(() =>
    createRegistry([
      {
        name: 'Graveyard loyalty fixture',
        type: 'planeswalker',
        cost: {},
        loyalty: 3,
        activated: [
          { zone: 'graveyard', cost: {}, loyalty: 1, effects: [{ op: 'draw', count: 1 }] },
        ],
      },
    ]),
  );
});

for (const name of ['Reassembling Skeleton', 'Merchant of Many Hats']) {
  test(`bot uses ${name} recursion but does not pay again while the same incarnation return is pending`, () => {
    let s = fixture();
    manaFor(s, name, 2);
    const card = put(s, name, 0, 'graveyard');
    const action = chooseBotCommand(s, 0);
    assert.ok(isActivation(action, card.id));
    s = act(s, 'activate', action);
    assert.ok(
      legalActions(s, 0).some((a) => isActivation(a, card.id)),
      'rules still permit repeats',
    );
    assert.ok(!isActivation(chooseBotCommand(s, 0), card.id));
    move(s, s.objects[card.id], 'exile');
    move(s, s.objects[card.id], 'graveyard');
    assert.ok(
      isActivation(chooseBotCommand(s, 0), card.id),
      'old incarnation pending return is irrelevant',
    );
  });
}

test('actual Skeleton casting, death, paid graveyard activation, and tapped return replay exactly', () => {
  let s;
  for (let seed = 1; seed <= 100; seed++) {
    s = createGame({
      catalog,
      seed,
      mulligan: false,
      decks: [
        [
          ...Array(4).fill('Reassembling Skeleton'),
          ...Array(4).fill('Shock'),
          ...Array(26).fill('Swamp'),
          ...Array(26).fill('Mountain'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    const hand = s.players[0].hand.map((id) => s.objects[id].name);
    if (
      hand.includes('Reassembling Skeleton') &&
      hand.includes('Shock') &&
      hand.includes('Mountain') &&
      hand.filter((n) => n === 'Swamp').length >= 2
    )
      break;
  }
  const handCard = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  assert.ok(handCard('Reassembling Skeleton'));
  while (s.step !== 'main1') s = act(s, 'pass');
  const nextMain = () => {
    const turn = s.turn;
    do {
      s =
        s.choice?.kind === 'attackers'
          ? act(s, 'attackers', { cards: [] })
          : s.choice?.kind === 'discard'
            ? act(s, 'discard', { cards: s.players[s.choice.player].hand.slice(0, s.choice.count) })
            : act(s, 'pass');
    } while (s.turn === turn || s.active !== 0 || s.step !== 'main1');
  };
  s = act(s, 'playLand', { card: handCard('Swamp') });
  nextMain();
  s = act(s, 'playLand', { card: handCard('Swamp') });
  const skeleton = handCard('Reassembling Skeleton');
  s = act(s, 'cast', { card: skeleton });
  s = resolve(s);
  nextMain();
  s = act(s, 'playLand', { card: handCard('Mountain') });
  s = act(s, 'cast', { card: handCard('Shock'), target: ref(s.objects[skeleton]) });
  s = resolve(s);
  assert.equal(s.objects[skeleton].zone, 'graveyard');
  const old = ref(s.objects[skeleton]);
  s = act(s, 'activate', { card: skeleton, ability: 0 });
  assert.equal(s.objects[skeleton].zone, 'graveyard');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = resolve(s);
  assert.equal(s.objects[skeleton].zone, 'battlefield');
  assert.equal(s.objects[skeleton].tapped, true);
  assert.ok(s.objects[skeleton].incarnation > old.incarnation);
  assert.deepEqual(replay(exportReplay(s)), s);
});
