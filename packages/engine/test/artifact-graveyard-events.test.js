import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, dispatch, chooseBotCommand, definition } from '../src/index.js';
import { move, sacrificePermanents, ref, addModifier } from '../src/model.js';
import { stabilize, resolveEffects } from '../src/effects.js';
import { fixture, put } from './helpers.js';
function settle(s) {
  stabilize(s);
  for (
    let i = 0;
    i < 60 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    i++
  ) {
    const p = s.choice?.player ?? s.priority;
    const r = dispatch(s, s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p });
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  return s;
}
test('Al Bhed observes a noncreature artifact, creature, artifact-creature, token and itself exactly once each', () => {
  for (const name of [
    'Fountainport Bell',
    'Grizzly Bears',
    'Ornithopter',
    'Treasure Token',
    'Al Bhed Salvagers',
  ]) {
    let s = fixture();
    const watcher = put(s, 'Al Bhed Salvagers');
    const victim = name === 'Al Bhed Salvagers' ? watcher : put(s, name);
    move(s, victim, 'graveyard');
    assert.equal(s.pendingTriggers.filter((t) => t.name === 'Al Bhed Salvagers').length, 1, name);
    s = settle(s);
    assert.equal(s.players[0].life, 21, name);
    assert.equal(s.players[1].life, 19, name);
  }
});
test('Al Bhed ignores enemy permanents, lands, exiles and artifacts discarded from hand', () => {
  for (const [name, owner, from, to] of [
    ['Fountainport Bell', 1, 'battlefield', 'graveyard'],
    ['Forest', 0, 'battlefield', 'graveyard'],
    ['Fountainport Bell', 0, 'battlefield', 'exile'],
    ['Fountainport Bell', 0, 'hand', 'graveyard'],
  ]) {
    const s = fixture();
    put(s, 'Al Bhed Salvagers');
    const o = put(s, name, owner, from);
    move(s, o, to);
    assert.equal(s.pendingTriggers.length, 0);
  }
});
test('Rest in Peace replacement suppresses graveyard triggers even if it leaves in same sacrifice batch', () => {
  const s = fixture();
  const watcher = put(s, 'Al Bhed Salvagers'),
    ring = put(s, 'Fountainport Bell'),
    rip = put(s, 'Rest in Peace');
  sacrificePermanents(s, [rip, watcher, ring]);
  assert.equal(s.pendingTriggers.length, 0);
  for (const o of [rip, watcher, ring]) assert.equal(o.zone, 'exile');
});
test('simultaneous departures retain watcher/controller/type LKI regardless of movement order', () => {
  for (const reverse of [false, true]) {
    let s = fixture();
    const watcher = put(s, 'Al Bhed Salvagers', 1),
      ring = put(s, 'Fountainport Bell', 1),
      thopter = put(s, 'Ornithopter', 1);
    watcher.controller = ring.controller = thopter.controller = 0;
    sacrificePermanents(s, reverse ? [thopter, ring, watcher] : [watcher, ring, thopter]);
    assert.equal(s.pendingTriggers.length, 3);
    assert.ok(s.pendingTriggers.every((t) => t.controller === 0));
    s = settle(s);
    assert.equal(s.players[0].life, 23);
    assert.equal(s.players[1].life, 17);
  }
});
test('legacy unfiltered dies remains creature-only and no unrelated trigger IDs are allocated', () => {
  const s = fixture();
  const watcher = put(s, 'Grizzly Bears');
  watcher.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    triggers: [
      { event: { event: 'dies', controller: 'you' }, effects: [{ op: 'gainLife', amount: 1 }] },
    ],
  };
  const ring = put(s, 'Fountainport Bell');
  const next = s.nextId;
  move(s, ring, 'graveyard');
  assert.equal(s.nextId, next);
  assert.equal(s.pendingTriggers.length, 0);
  move(s, watcher, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
});
test('explicit permanent-graveyard self event preserves departed source identity', () => {
  const s = fixture();
  const artifact = put(s, 'Fountainport Bell');
  artifact.definitionOverride = {
    ...CARDS['Fountainport Bell'],
    triggers: [
      {
        event: { event: 'battlefieldToGraveyard', object: 'source' },
        effects: [{ op: 'gainLife', amount: 1 }],
      },
    ],
  };
  const before = ref(artifact);
  move(s, artifact, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
  assert.deepEqual(s.pendingTriggers[0].source, before);
  assert.deepEqual(s.pendingTriggers[0].departedSource, ref(artifact));
});
test('earthbent noncreature land returns from graveyard and exile, but not hand', () => {
  for (const to of ['graveyard', 'exile', 'hand']) {
    let s = fixture();
    const land = put(s, 'Forest');
    resolveEffects(s, {
      kind: 'ability',
      source: ref(land),
      controller: 0,
      name: 'Earthbend',
      effects: [{ op: 'earthbend', amount: 2 }],
      target: ref(land),
      sourceKeywords: [],
    });
    addModifier(s, {
      objectId: land.id,
      incarnation: land.incarnation,
      landForm: { mana: ['G'] },
      permanent: true,
    });
    assert.ok(!definition(s, land).types.includes('creature'));
    move(s, land, to);
    assert.equal(
      s.pendingTriggers.filter((t) => t.rule === 'earthbendReturn').length,
      to === 'hand' ? 0 : 1,
    );
    s = settle(s);
    assert.equal(s.objects[land.id].zone, to === 'hand' ? 'hand' : 'battlefield');
    if (to !== 'hand') assert.equal(s.objects[land.id].tapped, true);
  }
});
