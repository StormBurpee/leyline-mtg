import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
  exportReplay,
  replay,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { autoCommand } from '../apps/web/priority-policy.js';
const names = [
  'Emberheart Challenger',
  'Flowerfoot Swordmaster',
  'Mouse Trapper',
  'Nettle Guard',
  'Seedglaive Mentor',
  'Veteran Guardmouse',
  'Ruric Thar, Biomagus',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
test('seven complete target-trigger sources compile and round trip every clause', async () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const source = JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
          import.meta.url,
        ),
      ),
    );
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[name]);
    assert.equal(compiled.definition.text, source.rulesText);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});
test('Mouse Trapper opens a deliberate target choice before ordinary priority automation', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const mouse = put(s, 'Mouse Trapper'),
    victim = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Giant Growth', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(mouse) });
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.equal(
    autoCommand(s, 0, {
      autoYield: true,
      controlMode: 'smart',
      stops: {},
      autoOrderTriggers: true,
    }),
    null,
  );
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(mouse) }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(victim) });
  s = resolve(s);
  assert.equal(s.objects[victim.id].tapped, true);
});
test('Nettle Guard grants toughness and its sacrifice activation keeps its complete second clause', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const mouse = put(s, 'Nettle Guard'),
    spell = put(s, 'Giant Growth', 0, 'hand'),
    artifact = put(s, 'Ornithopter', 1);
  s = act(s, 'cast', { card: spell.id, target: ref(mouse) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[mouse.id]).toughness, 3);
  s = act(s, 'activate', { card: mouse.id, ability: 0, target: ref(artifact) });
  assert.equal(s.objects[mouse.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[artifact.id].zone, 'graveyard');
});
test('a legal target-trigger replay preserves first-target history and stack ordering', () => {
  let s = createGame({
    seed: 9,
    mulligan: false,
    decks: [
      [
        ...Array(4).fill('Seedglaive Mentor'),
        ...Array(4).fill('Giant Growth'),
        ...Array(18).fill('Forest'),
        ...Array(17).fill('Mountain'),
        ...Array(17).fill('Plains'),
      ],
      Array(60).fill('Forest'),
    ],
  });
  let reached = false;
  for (let i = 0; i < 700; i++) {
    const p = s.choice?.player ?? s.priority,
      actions = legalActions(s, p);
    const target = Object.values(s.objects).find(
      (o) => o.zone === 'battlefield' && o.controller === 0 && o.name === 'Seedglaive Mentor',
    );
    const growth =
      p === 0 &&
      !s.choice &&
      target &&
      actions.find(
        (a) =>
          a.type === 'cast' &&
          s.objects[a.card].name === 'Giant Growth' &&
          a.target?.id === target.id,
      );
    const command = growth
      ? { ...growth, player: p }
      : s.choice
        ? s.choice.kind === 'attackers'
          ? { type: 'attackers', cards: [], player: p }
          : chooseBotCommand(s, p)
        : {
            ...(actions.find((a) => a.type === 'playLand') ??
              actions.find(
                (a) => a.type === 'cast' && s.objects[a.card].name === 'Seedglaive Mentor',
              ) ?? { type: 'pass' }),
            player: p,
          };
    const r = dispatch(s, command);
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
    if (growth) {
      reached = true;
      assert.equal(s.stack.at(-1).name, 'Seedglaive Mentor');
      const restored = replay(exportReplay(s));
      assert.deepEqual(exportReplay(restored), exportReplay(s));
      assert.deepEqual(
        restored.objects[target.id].targetHistory,
        s.objects[target.id].targetHistory,
      );
      break;
    }
  }
  assert.equal(reached, true);
});
test('Flowerfoot buffs only friendly Mice and Veteran grants first strike then scries', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const sword = put(s, 'Flowerfoot Swordmaster'),
    mouse = put(s, 'Seedglaive Mentor'),
    bear = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Seedglaive Mentor', 1);
  let spell = put(s, 'Giant Growth', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(sword) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[mouse.id]).power, CARDS[mouse.name].power + 1);
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
  assert.equal(stats(s, s.objects[enemy.id]).power, CARDS[enemy.name].power);
  s = resolve(s);
  const veteran = put(s, 'Veteran Guardmouse');
  spell = put(s, 'Giant Growth', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(veteran) });
  s = resolve(s);
  assert.equal(hasKeyword(s, s.objects[veteran.id], 'first strike'), true);
  assert.equal(s.choice.kind, 'libraryOrder');
});
test('Ruric keeps both prowess triggers', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const ruric = put(s, 'Ruric Thar, Biomagus'),
    spell = put(s, 'Giant Growth', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(ruric) });
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
});
test('unsupported targeting/first-event combinations and nonboolean limits fail closed', async () => {
  const original = JSON.parse(
    await readFile(new URL('../packages/cards/cards/seedglaive-mentor.json', import.meta.url)),
  );
  for (const patch of [
    { event: 'cast', firstEachTurn: true },
    { event: 'targeted', firstEachTurn: true },
    { event: 'targeted', object: 'source', firstEachTurn: 2 },
    { event: 'cast', targetingController: 'you' },
    { event: 'targeted', targetingKind: 'anything' },
  ]) {
    const source = structuredClone(original);
    source.abilities.at(-1).on = patch;
    assert.equal(compileCard(source, { mechanics }).ok, false, JSON.stringify(patch));
  }
  const source = structuredClone(original);
  source.abilities.at(-1).oncePerTurn = 1;
  assert.equal(compileCard(source, { mechanics }).ok, false);
});
test('Emberheart exiles its top card with end-of-turn permission after valiant resolves', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const mouse = put(s, 'Emberheart Challenger'),
    spell = put(s, 'Giant Growth', 0, 'hand'),
    top = s.players[0].library[0];
  s = act(s, 'cast', { card: spell.id, target: ref(mouse) });
  assert.equal(s.choice.kind, 'orderTriggers');
  const entries = s.choice.entries;
  const valiant = entries.find((e) => e.effects[0].op === 'impulseChoose');
  const prowess = entries.find((e) => e.effects[0].op === 'modify');
  s = act(s, 'orderTriggers', { ids: [prowess.id, valiant.id] });
  s = resolve(s);
  assert.equal(s.choice.kind, 'exilePlay');
  assert.equal(s.objects[top].zone, 'exile');
  s = act(s, 'chooseResolutionCard', { card: top });
  assert.deepEqual(s.objects[top].playPermission, {
    player: 0,
    turn: s.turn,
    incarnation: s.objects[top].incarnation,
  });
});
