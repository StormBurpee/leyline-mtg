import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createGame,
  dispatch,
  chooseBotCommand,
  exportReplay,
  replay,
  DECKS,
  expandDeck,
  CARDS,
  createRegistry,
} from '../src/index.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import assert from 'node:assert/strict';
import { definition, stats, move, copiableDefinition, ref, notifyTriggers } from '../src/model.js';
import { enterBattlefield, resolveEffects } from '../src/effects.js';
import { nextTurn, finishCleanup } from '../src/turn.js';
import { manaOptions, canTapForMana, tapForMana } from '../src/mana.js';
import { canAttack } from '../src/combat.js';
import { fixture, put, act, resolve, lands } from './helpers.js';
import { inspect } from '../../../apps/web/view.js';
const NAME = 'Hydro-Man, Fluid Felon';
function end(s) {
  s.step = 'main2';
  s.priority = s.active;
  s.passes = 0;
  s = resolve(s);
  assert.equal(s.stack.at(-1)?.name, NAME);
  return resolve(s);
}
function form(s, o, player = o.controller) {
  resolveEffects(s, {
    kind: 'ability',
    controller: player,
    source: ref(o),
    effects: [{ op: 'becomeLand', mana: ['U'] }],
  });
}
test('Hydro-Man own end step untaps into a blue legendary land with no creature subtype', () => {
  let s = fixture();
  const h = put(s, NAME);
  h.tapped = true;
  h.controlledSince = s.turn;
  s = end(s);
  const o = s.objects[h.id],
    d = definition(s, o);
  assert.equal(o.tapped, false);
  assert.deepEqual(d.types, ['land']);
  assert.deepEqual(d.subtypes, []);
  assert.deepEqual(d.color, ['U']);
  assert.equal(d.legendary, true);
  assert.equal(d.triggers.length, 2);
  assert.deepEqual(manaOptions(s, o), ['U']);
  assert.equal(canTapForMana(s, o, 0), true);
  assert.equal(canAttack(s, o, 0), false);
  assert.deepEqual(stats(s, o), { power: 0, toughness: 0 });
  tapForMana(s, o.id, 0, 'U');
  assert.equal(s.players[0].mana.U, 1);
});
test('land form survives cleanup and opponent turn and ends before original controller untap', () => {
  let s = fixture();
  const h = put(s, NAME);
  h.plusCounters = 2;
  s = end(s);
  finishCleanup(s);
  assert.equal(s.active, 1);
  assert.equal(definition(s, s.objects[h.id]).type, 'land');
  s.objects[h.id].tapped = true;
  nextTurn(s);
  assert.equal(s.active, 0);
  assert.equal(definition(s, s.objects[h.id]).type, 'creature');
  assert.equal(s.objects[h.id].tapped, false);
  assert.deepEqual(manaOptions(s, s.objects[h.id]), []);
  assert.deepEqual(stats(s, s.objects[h.id]), { power: 4, toughness: 4 });
});
test('expiry belongs to ability controller even after source control changes', () => {
  const s = fixture(),
    h = put(s, NAME);
  form(s, h, 0);
  h.controller = 1;
  nextTurn(s);
  assert.equal(definition(s, h).type, 'land');
  nextTurn(s);
  assert.equal(definition(s, h).type, 'creature');
});
test('resolution after control changes still uses original trigger controller duration', () => {
  let s = fixture();
  const h = put(s, NAME);
  s.step = 'main2';
  s = resolve(s);
  s.objects[h.id].controller = 1;
  s = resolve(s);
  nextTurn(s);
  assert.equal(definition(s, s.objects[h.id]).type, 'land');
  nextTurn(s);
  assert.equal(definition(s, s.objects[h.id]).type, 'creature');
});
test('stun replaces untap but does not prevent land transformation', () => {
  let s = fixture();
  const h = put(s, NAME);
  h.tapped = true;
  h.stunCounters = 2;
  s = end(s);
  const o = s.objects[h.id];
  assert.equal(o.tapped, true);
  assert.equal(o.stunCounters, 1);
  assert.equal(definition(s, o).type, 'land');
  assert.equal(canTapForMana(s, o, 0), false);
});
test('blue cast triggers buff, nonblue casts do not', () => {
  let s = fixture();
  const h = put(s, NAME);
  lands(s, 'Island', 3);
  const opt = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: opt.id });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[h.id]), { power: 3, toughness: 3 });
  const t = fixture(),
    other = put(t, NAME);
  notifyTriggers(t, 'cast', {
    player: 0,
    definition: { type: 'instant', types: ['instant'], color: ['R'], subtypes: [], keywords: [] },
  });
  assert.equal(t.pendingTriggers.length, 0);
  assert.equal(stats(t, other).power, 2);
});
test('intervening source creature condition checked at both trigger and resolution', () => {
  let s = fixture();
  const h = put(s, NAME);
  lands(s, 'Island', 2);
  const opt = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: opt.id });
  form(s, s.objects[h.id]);
  s = resolve(s);
  assert.equal(
    s.modifiers.some((m) => m.power === 1),
    false,
  );
  const t = fixture(),
    o = put(t, NAME);
  form(t, o);
  notifyTriggers(t, 'cast', {
    player: 0,
    definition: { type: 'instant', types: ['instant'], color: ['U'], subtypes: [], keywords: [] },
  });
  assert.equal(t.pendingTriggers.length, 0);
});
test('pending end step cannot untap or transform a new incarnation', () => {
  let s = fixture();
  const h = put(s, NAME);
  s.step = 'main2';
  s = resolve(s);
  move(s, s.objects[h.id], 'exile');
  enterBattlefield(s, s.objects[h.id], 0);
  s.objects[h.id].tapped = true;
  s = resolve(s);
  assert.equal(definition(s, s.objects[h.id]).type, 'creature');
  assert.equal(s.objects[h.id].tapped, true);
});
test('zone reset and layer-one copies exclude the land form and granted mana', () => {
  const s = fixture(),
    h = put(s, NAME);
  form(s, h);
  assert.equal(copiableDefinition(s, h).type, 'creature');
  assert.equal(copiableDefinition(s, h).mana, undefined);
  move(s, h, 'exile');
  enterBattlefield(s, h, 0);
  assert.equal(definition(s, h).type, 'creature');
  assert.deepEqual(manaOptions(s, h), []);
});
test('newer land animation can animate Hydro-Man without erasing his granted mana', () => {
  const s = fixture(),
    h = put(s, NAME);
  h.plusCounters = 2;
  form(s, h);
  resolveEffects(s, {
    kind: 'ability',
    controller: 0,
    source: ref(h),
    effects: [{ op: 'animateLand', power: 2, toughness: 2, colors: ['R', 'W'], subtypes: ['Ox'] }],
  });
  assert.deepEqual(definition(s, h).types, ['land', 'creature']);
  assert.deepEqual(definition(s, h).subtypes, ['Ox']);
  assert.deepEqual(stats(s, h), { power: 4, toughness: 4 });
  assert.deepEqual(manaOptions(s, h), ['U']);
  form(s, h);
  assert.equal(definition(s, h).type, 'land');
  assert.deepEqual(definition(s, h).subtypes, []);
});
test('land form retains existing land subtypes and strips artifact and creature subtypes', () => {
  const s = fixture(),
    h = put(s, NAME);
  h.definitionOverride = {
    ...copiableDefinition(s, h),
    types: ['land', 'artifact', 'creature'],
    subtypes: ['Island', 'Vehicle', 'Elemental'],
  };
  form(s, h);
  assert.deepEqual(definition(s, h).subtypes, ['Island']);
});
test('source keeps end-step trigger even while already a land', () => {
  let s = fixture();
  const h = put(s, NAME);
  form(s, h);
  h.tapped = true;
  s = end(s);
  assert.equal(s.objects[h.id].tapped, false);
});
test('inspection explains current type and the exact duration instead of printed creature alone', () => {
  const s = fixture(),
    h = put(s, NAME);
  form(s, h);
  const html = inspect(NAME, {}, s, h.id, 0);
  assert.match(html, /Land until/);
  assert.match(html, /next turn/);
  assert.match(html, /Add U/);
});
test('type replacement removes combat participation permanently even if later reanimated', () => {
  const s = fixture(),
    h = put(s, NAME),
    enemy = put(s, 'Grizzly Bears', 1);
  s.combat.attackers = [ref(h)];
  s.combat.blocks[h.id] = [ref(enemy)];
  form(s, h);
  assert.deepEqual(s.combat.attackers, []);
  assert.equal(s.combat.blocks[h.id], undefined);
  s.combat.attackers = [ref(enemy)];
  s.combat.blocks[enemy.id] = [ref(h)];
  form(s, h);
  assert.deepEqual(s.combat.blocks[enemy.id], []);
});
test('granted mana coexists with intrinsic colors and is unrestricted and free for its color', () => {
  const s = fixture(),
    h = put(s, NAME);
  h.definitionOverride = {
    ...copiableDefinition(s, h),
    mana: ['U', 'R'],
    manaConditions: { U: { kind: 'opponentTurn' } },
    manaRestrictions: { U: 'creature' },
    manaLifeCosts: { U: 1, R: 1 },
  };
  form(s, h);
  assert.deepEqual(manaOptions(s, h), ['U', 'R']);
  tapForMana(s, h.id, 0, 'U');
  assert.equal(s.players[0].life, 20);
  assert.equal(s.players[0].mana.U, 1);
  assert.equal(s.players[0].restrictedMana?.length ?? 0, 0);
});

test('bot plays Hydro-Man through a complete match and both active-form and final replays agree', () => {
  const deck = [
    ...Array(4).fill('Hydro-Man, Fluid Felon'),
    ...Array(4).fill('Opt'),
    ...Array(4).fill('Unsummon'),
    ...Array(4).fill('Cancel'),
    ...Array(24).fill('Island'),
  ];
  let s = createGame({
      decks: [deck, expandDeck(DECKS.ember.cards)],
      minimumDeckSize: 40,
      seed: 104729,
      mulligan: false,
    }),
    saw = false,
    checked = false,
    n = 0;
  while (s.status !== 'finished' && n < 1000) {
    const command = chooseBotCommand(s, s.choice?.player ?? s.priority);
    assert.ok(command);
    const result = dispatch(s, command);
    assert.equal(result.ok, true, result.error?.message);
    s = result.state;
    n++;
    if (s.modifiers.some((m) => m.landForm)) {
      saw = true;
      if (!checked) {
        assert.deepEqual(replay(exportReplay(s)), s);
        checked = true;
      }
    }
  }
  assert.ok(saw, 'Bot match never transformed Hydro-Man');
  assert.equal(s.status, 'finished');
  assert.deepEqual(replay(exportReplay(s)), s);
});
test('Hydro-Man compiles and round trips without weakening either trigger', async () => {
  const source = JSON.parse(
    await readFile(new URL('../../cards/cards/hydro-man-fluid-felon.json', import.meta.url)),
  );
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition, CARDS[NAME]);
  const round = compileCard(sourceFromDefinition(result.definition, { id: source.id }));
  assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
  assert.deepEqual(round.definition, result.definition);
  source.abilities[1].effects[1].until = 'endOfTurn';
  assert.equal(compileCard(source).ok, false);
});
test('native registry rejects unsupported mana-grant costs and malformed source type or grant', () => {
  const card = structuredClone(CARDS[NAME]);
  card.mana = 'U';
  card.manaSacrifice = true;
  assert.throws(() => createRegistry([card]), /sacrifice mana/);
  delete card.manaSacrifice;
  card.triggers[0].condition.type = 'nonsense';
  assert.throws(() => createRegistry([card]), /source type/);
  card.triggers[0].condition.type = 'creature';
  card.triggers[1].effects[1].mana = ['X'];
  assert.throws(() => createRegistry([card]), /granted mana/);
});
