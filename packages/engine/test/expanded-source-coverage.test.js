import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, dispatch, ref, stats, keywords } from '../src/index.js';
import { battlefield, definition, move, loseLife } from '../src/model.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { declareAttackers } from '../src/combat.js';
import { advanceStep } from '../src/turn.js';
import { fixture, put, act, resolve } from './helpers.js';
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
const target = (s, o) => act(s, 'chooseTriggerTarget', { target: ref(s.objects[o.id]) });
test('Aetherize returns all attacking creatures, including your own, but no idle creatures', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Llanowar Elves'),
    idle = put(s, 'Grizzly Bears', 1);
  s.step = 'attackers';
  declareAttackers(s, [a.id, b.id]);
  stabilize(s);
  s = cast(s, 'Aetherize').s;
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[b.id].zone, 'hand');
  assert.equal(s.objects[idle.id].zone, 'battlefield');
});
test('Broken Wings permits artifacts, enchantments and flying creatures but rejects grounded creatures', () => {
  for (const name of ['Basilisk Collar', 'Pacifism', 'Serra Angel', 'Grizzly Bears']) {
    let s = rich();
    const victim = put(s, name, 1),
      spell = put(s, 'Broken Wings', 0, 'hand');
    const r = dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(victim) });
    assert.equal(r.ok, name !== 'Grizzly Bears');
    if (r.ok) {
      s = resolve(r.state);
      assert.equal(s.objects[victim.id].zone, 'graveyard');
    }
  }
});
test('Seismic Rupture spares flying creatures and Fuel the Flames does not', () => {
  for (const spell of ['Seismic Rupture', 'Fuel the Flames']) {
    let s = rich();
    const ground = put(s, 'Grizzly Bears', 1),
      air = put(s, "Healer's Hawk", 1);
    s = cast(s, spell).s;
    assert.equal(s.objects[ground.id].zone, 'graveyard');
    assert.equal(s.objects[air.id].zone, spell === 'Seismic Rupture' ? 'battlefield' : 'graveyard');
    assert.equal(s.players[0].life, 20);
  }
});
test('Armaggon offers zero through three distinct ETB targets and resolves all chosen destructions', () => {
  for (const n of [0, 3]) {
    let s = rich();
    const victims = Array.from({ length: 3 }, () => put(s, 'Grizzly Bears', 1));
    let result = cast(s, 'Armaggon, Future Shark');
    s = result.s;
    assert.equal(s.choice.kind, 'triggerTargets');
    s = act(s, 'chooseTriggerTargets', { targets: { chosen: victims.slice(0, n).map(ref) } });
    s = resolve(s);
    victims.forEach((v, i) =>
      assert.equal(s.objects[v.id].zone, i < n ? 'graveyard' : 'battlefield'),
    );
    assert.equal(s.objects[result.id].zone, 'battlefield');
  }
});
test('Iridescent Tiger creates five colors only when its entry followed an actual cast', () => {
  let s = rich();
  const before = { ...s.players[0].mana };
  let r = cast(s, 'Iridescent Tiger');
  s = resolve(r.s);
  assert.equal(s.players[0].mana.U, before.U + 1);
  assert.equal(s.players[0].mana.B, before.B + 1);
  assert.equal(s.players[0].mana.W, before.W + 1);
  s = fixture();
  const tiger = put(s, 'Iridescent Tiger', 0, 'graveyard');
  enterBattlefield(s, tiger, 0);
  stabilize(s);
  assert.equal(s.stack.length, 0);
});
test('Tanglespan Lookout draws for friendly Aura entries, not non-Aura enchantments', () => {
  let s = rich();
  put(s, 'Tanglespan Lookout');
  const bear = put(s, 'Grizzly Bears');
  s = cast(s, 'Pacifism', { target: ref(bear) }).s;
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  s = cast(s, 'Phyrexian Arena').s;
  assert.equal(s.stack.length, 0);
});
test('Thunderhead Gunner discards as a cost and is sorcery-speed once per turn', () => {
  let s = rich();
  const gunner = put(s, 'Thunderhead Gunner'),
    fodder = put(s, 'Forest', 0, 'hand');
  s = act(s, 'activate', { card: gunner.id, ability: 0, discardCard: fodder.id });
  assert.equal(s.objects[fodder.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: gunner.id,
      ability: 0,
      discardCard: s.players[0].hand[0],
    }).ok,
    false,
  );
  s = rich();
  const g = put(s, 'Thunderhead Gunner'),
    f = put(s, 'Forest', 0, 'hand');
  s.step = 'combat';
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: g.id, ability: 0, discardCard: f.id }).ok,
    false,
  );
});
test('Zealous Lorecaster returns only an instant or sorcery owned by its controller', () => {
  let s = rich();
  const spell = put(s, 'Giant Growth', 0, 'graveyard');
  s = cast(s, 'Zealous Lorecaster').s;
  s = target(s, spell);
  s = resolve(s);
  assert.equal(s.objects[spell.id].zone, 'hand');
});
test('Boggart Cursecrafter excludes its own death and opponents Goblins', () => {
  let s = fixture();
  const b = put(s, 'Boggart Cursecrafter'),
    friend = put(s, 'Hired Claw'),
    gob = put(s, 'Goblin Token'),
    foe = put(s, 'Goblin Token', 1);
  move(s, friend, 'graveyard');
  move(s, foe, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
  move(s, gob, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  move(s, s.objects[b.id], 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
});
test('Spearguard and Necromage create the exact nonblocking black death tokens', () => {
  for (const [name, type, count] of [
    ['Harried Spearguard', 'Rat', 1],
    ['Synapse Necromage', 'Fungus', 2],
  ]) {
    let s = fixture();
    const o = put(s, name);
    move(s, o, 'graveyard');
    stabilize(s);
    s = resolve(s);
    const ts = battlefield(s).filter((o) => o.token);
    assert.equal(ts.length, count);
    for (const t of ts) {
      assert.ok(definition(s, t).subtypes.includes(type));
      assert.deepEqual(definition(s, t).color, ['B']);
      assert.equal(stats(s, t).power, 1);
      assert.equal(definition(s, t).cannotBlock, true);
    }
  }
});
test('Bloodtithe Collector requires opponent life loss and asks that opponent to discard', () => {
  for (const loss of [false, true]) {
    let s = rich();
    put(s, 'Forest', 1, 'hand');
    if (loss) loseLife(s, 1, 1);
    s = cast(s, 'Bloodtithe Collector').s;
    if (loss) {
      s = resolve(s);
      assert.equal(s.choice.kind, 'discardEffect');
      assert.equal(s.choice.player, 1);
    } else assert.equal(s.stack.length, 0);
  }
});
test('Fancy Footwork untaps and gives both targets +2/+2', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  a.tapped = b.tapped = true;
  s = cast(s, 'Fancy Footwork', { targets: { chosen: [ref(a), ref(b)] } }).s;
  for (const o of [a, b]) {
    assert.equal(s.objects[o.id].tapped, false);
    assert.equal(stats(s, s.objects[o.id]).power, 4);
  }
});
test('Trick Shot requires an OTHER token while Conduct Electricity may hit the same token twice', () => {
  for (const [name, valid] of [
    ['Trick Shot', false],
    ['Conduct Electricity', true],
  ]) {
    let s = rich();
    const t = put(s, 'Goblin Token', 1),
      spell = put(s, name, 0, 'hand');
    const r = dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      targets: { primary: [ref(t)], token: [ref(t)] },
    });
    assert.equal(r.ok, valid);
    if (valid) {
      s = resolve(r.state);
      assert.equal(s.objects[t.id], undefined);
    }
  }
});
test('Rite of the Dragoncaller makes a 5/5 red flying Dragon for an instant, not a creature', () => {
  let s = rich();
  put(s, 'Rite of the Dragoncaller');
  const spell = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  const dragon = battlefield(s).find((o) => o.token);
  assert.equal(stats(s, dragon).power, 5);
  assert.equal(stats(s, dragon).toughness, 5);
  assert.ok(keywords(s, dragon).includes('flying'));
  assert.deepEqual(definition(s, dragon).color, ['R']);
});
test('Pilfer reveals the opponents hand and permits a nonland choice only', () => {
  let s = rich();
  const land = put(s, 'Forest', 1, 'hand'),
    bear = put(s, 'Grizzly Bears', 1, 'hand');
  s = cast(s, 'Pilfer', { target: { kind: 'player', id: 1 } }).s;
  assert.equal(s.choice.kind, 'revealDiscard');
  assert.equal(dispatch(s, { type: 'chooseResolutionCard', player: 0, card: land.id }).ok, false);
  s = act(s, 'chooseResolutionCard', { card: bear.id });
  assert.equal(s.objects[bear.id].zone, 'graveyard');
  assert.equal(s.objects[land.id].zone, 'hand');
});
test('Slagstorm modes independently damage creatures or players', () => {
  for (const mode of [0, 1]) {
    let s = rich();
    const b = put(s, 'Grizzly Bears');
    s = cast(s, 'Slagstorm', { mode }).s;
    assert.equal(s.players[0].life, mode === 1 ? 17 : 20);
    assert.equal(s.players[1].life, mode === 1 ? 17 : 20);
    assert.equal(s.objects[b.id].zone, mode === 0 ? 'graveyard' : 'battlefield');
  }
});
test('Ravenous Giant deals damage only at its controllers upkeep', () => {
  let s = fixture();
  put(s, 'Ravenous Giant');
  s.step = 'untap';
  advanceStep(s);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 19);
  assert.equal(s.players[1].life, 20);
});
test('Midnight Reaper notices its own nontoken death and damages before drawing', () => {
  let s = fixture();
  const reaper = put(s, 'Midnight Reaper'),
    token = put(s, 'Goblin Token');
  move(s, token, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
  move(s, reaper, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].life, 19);
  assert.equal(s.players[0].hand.length, 1);
});
test('Helping Hand returns a low-mana creature tapped and rejects a larger creature', () => {
  let s = rich();
  const low = put(s, 'Grizzly Bears', 0, 'graveyard'),
    high = put(s, 'Serra Angel', 0, 'graveyard'),
    spell = put(s, 'Helping Hand', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(high) }).ok,
    false,
  );
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(low) }));
  assert.equal(s.objects[low.id].zone, 'battlefield');
  assert.equal(s.objects[low.id].tapped, true);
});
test('Ancestor Dragon gains once per attack group for every creature still attacking', () => {
  let s = fixture();
  const dragon = put(s, 'Ancestor Dragon'),
    bear = put(s, 'Grizzly Bears');
  s.step = 'attackers';
  declareAttackers(s, [dragon.id, bear.id]);
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
});
test('attack conditions preserve exact token and artifact thresholds', () => {
  for (const [name, n, bonus] of [
    ['Seasoned Warrenguard', 0, 0],
    ['Seasoned Warrenguard', 1, 2],
    ['Brazen Blademaster', 1, 0],
    ['Brazen Blademaster', 2, 2],
  ]) {
    let s = fixture();
    const a = put(s, name);
    for (let i = 0; i < n; i++)
      put(s, name === 'Seasoned Warrenguard' ? 'Goblin Token' : 'Basilisk Collar');
    const base = stats(s, a).power;
    s.step = 'attackers';
    declareAttackers(s, [a.id]);
    stabilize(s);
    if (s.stack.length) s = resolve(s);
    assert.equal(stats(s, s.objects[a.id]).power, base + bonus);
  }
});
test('cast filters count mana value four, noncreatures and Dragons without broadening them', () => {
  let s = rich();
  const lizard = put(s, 'Lurking Lizards');
  const spell = put(s, 'Serra Angel', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(s.objects[lizard.id].plusCounters, 1);
  s = rich();
  const spider = put(s, 'Spider Manifestation');
  spider.tapped = true;
  const spell2 = put(s, 'Serra Angel', 0, 'hand');
  s = act(s, 'cast', { card: spell2.id });
  s = resolve(s);
  assert.equal(s.objects[spider.id].tapped, false);
  s = rich();
  put(s, 'Firespitter Whelp');
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: bear.id });
  assert.equal(s.stack.length, 1);
});
test('Walltop Sentries checks its controllers graveyard for a Lesson when it dies', () => {
  for (const lesson of [false, true]) {
    let s = fixture();
    const sentry = put(s, 'Walltop Sentries');
    if (lesson) put(s, 'Fancy Footwork', 0, 'graveyard');
    move(s, sentry, 'graveyard');
    stabilize(s);
    if (s.stack.length) s = resolve(s);
    assert.equal(s.players[0].life, lesson ? 22 : 20);
  }
});
test('Pileated Provisioner targets friendly grounded creatures but not friendly fliers', () => {
  let s = rich();
  const grounded = put(s, 'Grizzly Bears'),
    air = put(s, 'Serra Angel');
  s = cast(s, 'Pileated Provisioner').s;
  assert.equal(dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(air) }).ok, false);
  s = target(s, grounded);
  s = resolve(s);
  assert.equal(s.objects[grounded.id].plusCounters, 1);
});
test('Ozais Cruelty targets either player and preserves damage then mandatory discard', () => {
  let s = rich();
  put(s, 'Forest', 1, 'hand');
  put(s, 'Swamp', 1, 'hand');
  s = cast(s, "Ozai's Cruelty", { target: { kind: 'player', id: 1 } }).s;
  assert.equal(s.players[1].life, 18);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [...s.players[1].hand] });
  assert.equal(s.players[1].hand.length, 0);
});
test('Agent Bishop can put counters on up to two creatures at the beginning of your combat', () => {
  let s = fixture();
  put(s, 'Agent Bishop, Man in Black');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  advanceStep(s);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(a), ref(b)] } });
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 1);
});
test('Undergrowth Recon returns a targeted land from your graveyard tapped at upkeep', () => {
  let s = fixture();
  put(s, 'Undergrowth Recon');
  const land = put(s, 'Forest', 0, 'graveyard');
  s.step = 'untap';
  advanceStep(s);
  stabilize(s);
  s = target(s, land);
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].tapped, true);
});
test('Battle-Rattle Shaman targets before resolution and allows declining its optional pump', () => {
  for (const accept of [false, true]) {
    let s = fixture();
    put(s, 'Battle-Rattle Shaman');
    const bear = put(s, 'Grizzly Bears');
    advanceStep(s);
    stabilize(s);
    s = target(s, bear);
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    s = act(s, 'resolveOptional', { accept });
    assert.equal(stats(s, s.objects[bear.id]).power, accept ? 4 : 2);
  }
});
