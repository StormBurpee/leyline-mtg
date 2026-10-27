import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  definition,
  dispatch,
  chooseBotCommand,
  legalActions,
  exportReplay,
  replay,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createSession } from '../packages/simulation/session.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { crewPosition } from './helpers/crew-position.js';
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const names = [
  'Air Response Unit',
  'Clamorous Ironclad',
  "Cultivator's Caravan",
  'Dependable Quinjet',
  'Skybox Ferry',
  "Adventurer's Airship",
  'Boosted Sloop',
  'Careening Mine Cart',
  'Debris Beetle',
  'Fire Nation Warship',
  'Hulldrifter',
  'Ripclaw Wrangler',
  'S.H.I.E.L.D. Helicarrier',
  'Spotcycle Scouter',
  'Strixhaven Skycoach',
  'Veloheart Bike',
  'Burner Rocket',
  'Thundering Broodwagon',
];
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
function settle(s) {
  for (let i = 0; i < 60 && (s.choice || s.stack.length || s.resolving); i++) {
    const p = s.choice?.player ?? s.priority;
    const r = dispatch(s, s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p });
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.resolving, null);
  return s;
}
test('18 complete Vehicle sources round-trip crew alongside every additional ability', async () => {
  for (const name of names) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[name]);
    assert.match(source.rulesText, /Crew \d/);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});
for (const name of names)
  test(`${name}: cast, full ETB, crew and attack execute without skipping choices`, () => {
    let s = fixture();
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[color] = 30;
    for (let i = 0; i < 5; i++) put(s, 'Grizzly Bears');
    put(s, 'Grizzly Bears', 1);
    put(s, 'Grizzly Bears', 1, 'hand');
    const card = put(s, name, 0, 'hand');
    s = settle(act(s, 'cast', { card: card.id }));
    assert.equal(definition(s, s.objects[card.id]).type, 'artifact');
    const crew = legalActions(s, 0).find((a) => a.type === 'crew' && a.card === card.id);
    assert.ok(crew);
    s = settle(act(s, 'crew', crew));
    assert.equal(definition(s, s.objects[card.id]).type, 'creature');
    s.objects[card.id].controlledSince = 0;
    s.step = 'attackers';
    s.choice = { kind: 'attackers', player: 0 };
    s = settle(act(s, 'attackers', { cards: [card.id] }));
    assert.equal(s.objects[card.id].zone, 'battlefield');
  });

test('crew replay round-trip and opaque session handles preserve every selected cost creature', () => {
  let s = crewPosition();
  const before = exportReplay(s);
  const command = { ...legalActions(s, 0).find((a) => a.type === 'crew'), player: 0 };
  s = resolve(act(s, 'crew', command));
  const restored = replay(exportReplay(s));
  assert.deepEqual(restored, s);
  const session = createSession(before.config);
  // Decode the replay's public actions into the current opaque perspective.
  for (const command of before.commands) {
    const ctx = session.context();
    const action =
      (command.type === 'attackers' ? command : null) ??
      ctx.actions.find(
        (a) =>
          a.type === command.type &&
          ((command.type !== 'cast' && command.type !== 'playLand') ||
            ctx.observation.objects[a.card]?.name ===
              replay({
                ...before,
                commands: before.commands.slice(0, before.commands.indexOf(command)),
              }).objects[command.card].name),
      );
    assert.ok(action, command.type);
    assert.equal(session.step(action).ok, true);
  }
  const ctx = session.context();
  const crew = ctx.actions.find((a) => a.type === 'crew');
  assert.ok(crew);
  assert.match(crew.card, /^object:/);
  assert.ok(crew.cards.every((id) => id.startsWith('object:')));
  assert.equal(session.step(crew).ok, true);
});

test('source compiler rejects incomplete crew, duplicate crew and unsupported extensions', async () => {
  const source = JSON.parse(
    await readFile(new URL('../packages/cards/cards/air-response-unit.json', import.meta.url)),
  );
  for (const abilities of [
    [{ kind: 'crew' }],
    [{ kind: 'crew', power: 1.5 }],
    [
      { kind: 'crew', power: 1 },
      { kind: 'crew', power: 2 },
    ],
    [{ kind: 'crew', power: 1, oncePerTurn: true }],
  ]) {
    const result = compileCard({ ...source, abilities });
    assert.equal(result.ok, false, JSON.stringify(abilities));
  }
});

test('Mine Cart cannot tap for mana; its attack creates the Treasure that can', () => {
  let s = fixture();
  const cart = put(s, 'Careening Mine Cart');
  put(s, 'Grizzly Bears');
  const assertNoMana = () => {
    assert.equal(
      legalActions(s, 0).some((a) => a.type === 'tapMana' && a.card === cart.id),
      false,
    );
    for (const color of ['W', 'U', 'B', 'R', 'G']) {
      const result = dispatch(s, { type: 'tapMana', player: 0, card: cart.id, color });
      assert.equal(result.ok, false, `Mine Cart must not produce ${color}`);
    }
    assert.equal(s.objects[cart.id].tapped, false);
  };
  assertNoMana();
  const crew = legalActions(s, 0).find((a) => a.type === 'crew' && a.card === cart.id);
  assert.ok(crew);
  s = settle(act(s, 'crew', crew));
  assert.equal(definition(s, s.objects[cart.id]).type, 'creature');
  assertNoMana();
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = settle(act(s, 'attackers', { cards: [cart.id] }));
  const treasures = Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'Treasure Token',
  );
  assert.equal(treasures.length, 1);
  const treasure = treasures[0];
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.type === 'tapMana' && a.card === treasure.id)
      .map((a) => a.color)
      .sort(),
    ['B', 'G', 'R', 'U', 'W'],
  );
  s = act(s, 'tapMana', { card: treasure.id, color: 'R' });
  assert.equal(s.players[0].mana.R, 1);
  assert.notEqual(s.objects[treasure.id]?.zone, 'battlefield');
  assert.equal(s.objects[cart.id].zone, 'battlefield');
});

test('audited Vehicle mana comes from their own ability, never token reminder text', () => {
  const audited = [...names, 'Apocalypse Runner', 'Detention Chariot'];
  const legitimate = new Set(["Cultivator's Caravan", 'Dependable Quinjet', 'Veloheart Bike']);
  for (const name of audited) {
    const s = fixture();
    const vehicle = put(s, name);
    const mana = legalActions(s, 0).filter((a) => a.type === 'tapMana' && a.card === vehicle.id);
    assert.deepEqual(
      mana.map((a) => a.color).sort(),
      legitimate.has(name) ? ['B', 'G', 'R', 'U', 'W'] : [],
      name,
    );
  }
});
