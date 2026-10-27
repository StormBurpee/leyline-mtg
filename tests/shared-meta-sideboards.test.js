import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  legalActions,
  ref,
  chooseBotCommand,
  dispatch,
} from '../packages/engine/src/index.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { spellProfile } from '../packages/engine/src/spell-modes.js';
for (const [mode, mana, damage] of [
  [0, 1, 1],
  [1, 3, 2],
  [2, 6, 3],
])
  test(`Fire Magic tier ${mode} pays ${mana} and deals ${damage}`, () => {
    let s = fixture();
    s.players[0].mana.R = mana;
    const creature = put(s, 'Serra Angel', 1),
      spell = put(s, 'Fire Magic', 0, 'hand');
    const action = legalActions(s, 0).find(
      (a) => a.type === 'cast' && a.card === spell.id && a.mode === mode,
    );
    assert.ok(action);
    s = act(s, 'cast', action);
    assert.equal(s.players[0].mana.R, 0);
    s = resolve(s);
    assert.equal(s.objects[creature.id].damage, damage);
    assert.equal(CARDS['Fire Magic'].cost.R, 1);
    assert.equal(spellProfile(CARDS['Fire Magic'], mode).cost.generic ?? 0, mana - 1);
  });
test('Sear can target a creature but cannot target a player', () => {
  let s = fixture();
  s.players[0].mana.R = 2;
  const c = put(s, 'Serra Angel', 1),
    spell = put(s, 'Sear', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: { kind: 'player', id: 1 } }).ok,
    false,
  );
  s = act(s, 'cast', { card: spell.id, target: ref(c) });
  s = resolve(s);
  assert.equal(s.objects[c.id].zone, 'graveyard');
});
test('Broadside Barrage damages, draws, then offers discard that bot can finish', () => {
  let s = fixture();
  s.players[0].mana.R = 2;
  s.players[0].mana.U = 1;
  const c = put(s, 'Serra Angel', 1),
    spell = put(s, 'Broadside Barrage', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(c) });
  s = resolve(s);
  assert.equal(s.objects[c.id].damage, 5);
  assert.ok(s.choice);
  const result = dispatch(s, chooseBotCommand(s, 0));
  assert.equal(result.ok, true);
  s = result.state;
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.objects[c.id].zone, 'graveyard');
});

test('Quantum Riddler replaces the whole draw instruction once per permanent', async () => {
  const { draw } = await import('../packages/engine/src/model.js');
  const s = fixture();
  put(s, 'Quantum Riddler');
  draw(s, 0, 2);
  assert.equal(s.players[0].hand.length, 3);
  draw(s, 0, 1);
  assert.equal(s.players[0].hand.length, 4);
  const t = fixture();
  put(t, 'Quantum Riddler');
  put(t, 'Quantum Riddler');
  draw(t, 0, 2);
  assert.equal(t.players[0].hand.length, 4);
  const u = fixture();
  put(u, 'Quantum Riddler', 1);
  draw(u, 0, 1);
  assert.equal(u.players[0].hand.length, 1);
});
test('Lantern sacrifices and exiles only opponent graveyard, never its own graveyard', () => {
  let s = fixture();
  const lantern = put(s, 'Soul-Guide Lantern');
  const own = put(s, 'Shock', 0, 'graveyard'),
    enemy = put(s, 'Shock', 1, 'graveyard');
  s = act(s, 'activate', { card: lantern.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.objects[lantern.id].zone, 'graveyard');
  assert.equal(s.objects[own.id].zone, 'graveyard');
  assert.equal(s.objects[enemy.id].zone, 'exile');
});
test('Lantern second ability pays one, sacrifices, and draws', () => {
  let s = fixture();
  s.players[0].mana.C = 1;
  const lantern = put(s, 'Soul-Guide Lantern');
  s = act(s, 'activate', { card: lantern.id, ability: 1 });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.objects[lantern.id].zone, 'graveyard');
  assert.equal(s.players[0].mana.C, 0);
});

test('Sunspine prevents life gain including lifelink only while battlefield ability exists', async () => {
  const { dealDamage, damageCanBePrevented, canGainLife } = await import(
    '../packages/engine/src/effects.js'
  );
  const { move } = await import('../packages/engine/src/model.js');
  const s = fixture(),
    lynx = put(s, 'Sunspine Lynx'),
    vampire = put(s, 'Vampire Nighthawk');
  assert.equal(canGainLife(s), false);
  assert.equal(damageCanBePrevented(s), false);
  dealDamage(
    s,
    { ...ref(vampire), controller: 0, keywords: ['lifelink'] },
    { kind: 'player', id: 1 },
    2,
  );
  assert.equal(s.players[0].life, 20);
  move(s, lynx, 'graveyard');
  assert.equal(canGainLife(s), true);
  assert.equal(damageCanBePrevented(s), true);
  dealDamage(
    s,
    { ...ref(vampire), controller: 0, keywords: ['lifelink'] },
    { kind: 'player', id: 1 },
    2,
  );
  assert.equal(s.players[0].life, 22);
});
test('Sunspine counts each players nonbasic lands separately', () => {
  let s = fixture();
  s.players[0].mana.R = 4;
  put(s, 'Forest');
  put(s, 'Cavern of Souls');
  put(s, 'Cavern of Souls', 1);
  put(s, 'Cavern of Souls', 1);
  const lynx = put(s, 'Sunspine Lynx', 0, 'hand');
  s = act(s, 'cast', { card: lynx.id });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 19);
  assert.equal(s.players[1].life, 18);
});
test('Magebane counts the actual casting player and all their noncreature spells this turn at resolution', () => {
  let s = fixture();
  put(s, 'Magebane Lizard');
  s.players[0].mana.R = 2;
  s.players[1].mana.R = 2;
  const shock = put(s, 'Shock', 0, 'hand');
  s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[0].life, 19);
  s = resolve(s);
  const second = put(s, 'Shock', 0, 'hand');
  s = act(s, 'cast', { card: second.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[0].life, 17);
  s = resolve(s);
  const enemy = put(s, 'Shock', 1, 'hand');
  s = act(s, 'pass');
  s = act(s, 'cast', { card: enemy.id, target: { kind: 'player', id: 0 } }, 1);
  s = resolve(s);
  assert.equal(s.players[1].life, 15);
});

for (const [mode, copies] of [
  [0, 0],
  [2, 1],
])
  test(`Stallion checks real tier payment; Fire Magic mode ${mode} creates ${copies} copies`, () => {
    let s = fixture();
    s.players[0].mana.R = 10;
    const horse = put(s, 'Colorstorm Stallion'),
      spell = put(s, 'Fire Magic', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, mode });
    s = resolve(s);
    assert.equal(
      Object.values(s.objects).filter(
        (o) => o.name === 'Colorstorm Stallion' && o.zone === 'battlefield',
      ).length,
      1 + copies,
    );
    const token = Object.values(s.objects).find((o) => o.name === 'Colorstorm Stallion' && o.token);
    if (token) assert.equal(token.plusCounters, 0);
  });

test('Avengers Disassembled both instructions preserve land controller for optional search', () => {
  let s = fixture();
  s.players[0].mana.R = 3;
  const bear = put(s, 'Grizzly Bears', 1),
    land = put(s, 'Forest', 1),
    basic = put(s, 'Forest', 1, 'library'),
    spell = put(s, 'Avengers Disassembled', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 2, target: ref(land) });
  s = resolve(s);
  assert.equal(s.objects[bear.id].damage, 3);
  assert.equal(s.objects[land.id].zone, 'graveyard');
  assert.equal(s.choice.player, 1);
  s = act(s, 'searchLibrary', { cards: [basic.id] }, 1);
  assert.equal(s.objects[basic.id].zone, 'battlefield');
  assert.equal(s.objects[basic.id].tapped, true);
  assert.equal(s.objects[bear.id].zone, 'graveyard');
});

for (const mode of [0, 1])
  test(`Blooming Blast gift ${mode} gives Treasure before damage and deals correct life loss`, () => {
    let s = fixture();
    s.players[0].mana.R = 2;
    const bear = put(s, 'Grizzly Bears', 1),
      spell = put(s, 'Blooming Blast', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, mode, target: ref(bear) });
    s = resolve(s);
    assert.equal(s.players[1].life, mode ? 17 : 20);
    assert.equal(
      Object.values(s.objects).filter(
        (o) => o.zone === 'battlefield' && o.name === 'Treasure Token' && o.controller === 1,
      ).length,
      mode,
    );
    assert.equal(s.objects[bear.id].zone, 'graveyard');
  });
test('Blooming Blast countered by absent target does not give a gift', async () => {
  const { move } = await import('../packages/engine/src/model.js');
  let s = fixture();
  s.players[0].mana.R = 2;
  const bear = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Blooming Blast', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 1, target: ref(bear) });
  move(s, s.objects[bear.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[1].life, 20);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Treasure Token').length, 0);
});

test('Jasper counts outlaws and grants foreign creatures Mercenary without changing copy values', async () => {
  const { definition, copiableDefinition, notifyTriggers, move } = await import(
    '../packages/engine/src/model.js'
  );
  let s = fixture();
  const jasper = put(s, 'Laughing Jasper Flint'),
    foreign = put(s, 'Grizzly Bears', 1);
  foreign.controller = 0;
  assert.ok(definition(s, foreign).subtypes.includes('Mercenary'));
  assert.ok(!copiableDefinition(s, foreign).subtypes.includes('Mercenary'));
  const angel = put(s, 'Serra Angel', 1, 'library'),
    land = put(s, 'Forest', 1, 'library');
  s.players[1].library = [
    angel.id,
    land.id,
    ...s.players[1].library.filter((id) => ![angel.id, land.id].includes(id)),
  ];
  notifyTriggers(s, 'step', { player: 0, step: 'upkeep' });
  s = act(s, 'pass');
  for (let i = 0; i < 12 && (s.choice || s.stack.length || s.pendingTriggers.length); i++) {
    const p = s.choice?.player ?? s.priority;
    s = act(
      s,
      s.choice ? chooseBotCommand(s, p).type : 'pass',
      s.choice ? chooseBotCommand(s, p) : {},
      p,
    );
  }
  assert.equal(s.objects[angel.id].zone, 'exile');
  assert.equal(s.objects[land.id].zone, 'exile');
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'playLand' && a.card === land.id),
    false,
  );
  s.step = 'main1';
  s.priority = 0;
  s.players[0].mana.C = 5;
  s = act(s, 'cast', { card: angel.id });
  assert.equal(s.players[0].mana.C, 0);
  s = resolve(s);
  assert.equal(s.objects[angel.id].controller, 0);
  assert.equal(s.objects[angel.id].owner, 1);
  assert.ok(definition(s, s.objects[angel.id]).subtypes.includes('Mercenary'));
  move(s, s.objects[jasper.id], 'graveyard');
  assert.ok(!definition(s, s.objects[angel.id]).subtypes.includes('Mercenary'));
});

test('Jasper any-type mana does not let an off-color creature convoke a colored cost', async () => {
  const { planPayment } = await import('../packages/engine/src/mana.js');
  const s = fixture();
  put(s, 'Grizzly Bears');
  s.players[0].mana.C = 1;
  const purpose = { type: 'cast', card: { type: 'instant', manaAsAnyType: true } };
  assert.equal(planPayment(s, 0, { R: 2 }, { purpose, convoke: true }), null);
  s.players[0].mana.C = 2;
  assert.ok(planPayment(s, 0, { R: 2 }, { purpose, convoke: true }));
});
test('Jasper stolen-card permission expires and does not permit owner to cast', () => {
  const s = fixture(),
    card = put(s, 'Shock', 1, 'exile');
  card.playPermission = {
    player: 0,
    turn: s.turn,
    incarnation: card.incarnation,
    castOnly: true,
    anyMana: true,
  };
  s.players[0].mana.C = 1;
  s.players[1].mana.R = 1;
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === card.id));
  s.priority = 1;
  assert.ok(!legalActions(s, 1).some((a) => a.type === 'cast' && a.card === card.id));
  s.turn++;
  s.priority = 0;
  assert.ok(!legalActions(s, 0).some((a) => a.type === 'cast' && a.card === card.id));
});

test('Bot risk uses Quantum replacement and Sunspine life-gain prohibition', async () => {
  const { resolutionRisk, actionSafe } = await import('../packages/engine/src/decision-safety.js');
  const s = fixture();
  put(s, 'Quantum Riddler');
  s.players[0].library = s.players[0].library.slice(0, 1);
  assert.equal(resolutionRisk(s, 0, [{ op: 'draw', count: 1 }], null), 'library');
  put(s, 'Sunspine Lynx');
  s.players[0].life = 1;
  assert.equal(
    resolutionRisk(
      s,
      0,
      [
        { op: 'loseLife', amount: 1 },
        { op: 'gainLife', amount: 3 },
      ],
      null,
    ),
    'life',
  );
});

test('Shared meta cards preserve native definitions through source compilation', async () => {
  const { readFile } = await import('node:fs/promises');
  const { compileCard } = await import('../packages/cards/compiler.js');
  const { sourceFromDefinition } = await import('../packages/cards/from-native.js');
  const mechanics = JSON.parse(
    await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
  );
  for (const slug of [
    'sear',
    'broadside-barrage',
    'fire-magic',
    'quantum-riddler',
    'soul-guide-lantern',
    'sunspine-lynx',
    'magebane-lizard',
    'colorstorm-stallion',
    'avengers-disassembled',
    'blooming-blast',
    'laughing-jasper-flint',
  ]) {
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    const first = compileCard(source, {
      identities: { 'leyline:token/treasure-token': 'Treasure Token' },
    });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const second = compileCard(sourceFromDefinition(first.definition, { id: source.id }), {
      mechanics,
    });
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(second.definition, first.definition);
  }
});
test('Jasper exiled cards appear in hand-sized playable presentation with clear permission text', async () => {
  const { game } = await import('../apps/web/view.js');
  const s = fixture(),
    card = put(s, 'Serra Angel', 1, 'exile');
  card.playPermission = {
    player: 0,
    turn: s.turn,
    incarnation: card.incarnation,
    castOnly: true,
    anyMana: true,
  };
  s.players[0].mana.C = 5;
  const html = game(
    s,
    {
      mode: 'bot',
      chosen: [],
      blocks: [],
      activation: null,
      controlMode: 'smart',
      stops: {},
      view: 'play',
      sideTab: 'stack',
      selected: card.id,
    },
    {},
  );
  assert.match(html, /Exiled spell: cast this turn using mana of any type/);
  assert.match(html, /Serra Angel/);
});

test('Transformed Roku inspector uses Avatar artwork and rules rather than front-face Saga', async () => {
  const { inspect } = await import('../apps/web/view.js');
  const s = fixture(),
    roku = put(s, 'The Legend of Roku // Avatar Roku');
  roku.transformed = true;
  const html = inspect(
    roku.name,
    {
      'Avatar Roku': {
        image: 'https://example.com/avatar.jpg',
        oracle_text: 'Firebending 4',
        type_line: 'Legendary Creature — Avatar',
      },
      [roku.name]: { image: 'https://example.com/saga.jpg', oracle_text: 'Chapter I' },
    },
    s,
    roku.id,
  );
  assert.match(html, /avatar.jpg/);
  assert.match(html, /Firebending 4/);
  assert.doesNotMatch(html, /saga.jpg/);
  assert.doesNotMatch(html, /Chapter I/);
});
