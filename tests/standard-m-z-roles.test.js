import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  legalActions,
  ref,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = [
  'Protective Parents',
  'Redtooth Genealogist',
  'Royal Treatment',
  'Shatter the Oath',
  'Spiteful Hexmage',
  'Splashy Spellcaster',
  "The Witch's Vanity",
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('7 complete Role cards compile and round trip every clause', () => {
  for (const source of sources) {
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[source.name]);
    assert.equal(compiled.definition.text, source.rulesText);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, source.name + JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});

import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefieldBatch, stabilize } from '../packages/engine/src/effects.js';
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
import { notifyTriggers } from '../packages/engine/src/model.js';
import { wardCosts, move } from '../packages/engine/src/model.js';
const aura = (s, name) =>
  Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.name === name);
test('Protective Parents death attaches Young Hero to its optional chosen creature', () => {
  let s = fixture();
  const parent = put(s, 'Protective Parents'),
    bear = put(s, 'Grizzly Bears');
  parent.damage = 99;
  stabilize(s);
  assert.equal(s.objects[parent.id].zone, 'graveyard');
  s = act(s, 'chooseTriggerTargets', { targets: { recipient: [ref(bear)] } });
  s = resolve(s);
  assert.deepEqual(aura(s, 'Young Hero').attachedTo, ref(s.objects[bear.id]));
  notifyTriggers(s, 'attack', { object: s.objects[bear.id] });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[bear.id].plusCounters, 1);
});
test('Protective Parents permits no recipient without producing an unattached token', () => {
  let s = fixture();
  const parent = put(s, 'Protective Parents');
  parent.damage = 99;
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { recipient: [] } });
  s = resolve(s);
  assert(!aura(s, 'Young Hero'));
});
test('Redtooth Genealogist requires another own creature and grants exact Royal ward', () => {
  let s = fixture();
  const bear = put(s, 'Grizzly Bears'),
    elf = enter(s, 'Redtooth Genealogist');
  assert.throws(() => act(s, 'chooseTriggerTarget', { target: ref(elf) }));
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  s = resolve(s);
  assert.deepEqual(aura(s, 'Royal').attachedTo, ref(s.objects[bear.id]));
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.deepEqual(wardCosts(s, s.objects[bear.id]), [{ mana: { generic: 1 } }]);
});
test('Royal Treatment gives temporary hexproof and replaces an own previous Role', () => {
  let s = fixture();
  lands(s, 'Forest', 1);
  const hex = enter(s, 'Spiteful Hexmage');
  s = act(s, 'chooseTriggerTarget', { target: ref(hex) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[hex.id]).power, 1);
  const spell = put(s, 'Royal Treatment', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(s.objects[hex.id]) });
  s = resolve(s);
  assert(hasKeyword(s, s.objects[hex.id], 'hexproof'));
  assert(!aura(s, 'Cursed'));
  assert(aura(s, 'Royal'));
  assert.equal(stats(s, s.objects[hex.id]).power, 4);
});
test('Shatter the Oath destroys its first target and attaches Wicked to a separate optional recipient', () => {
  let s = fixture();
  lands(s, 'Swamp', 5);
  const enemy = put(s, 'Grizzly Bears', 1),
    own = put(s, 'Grizzly Bears');
  const spell = put(s, 'Shatter the Oath', 0, 'hand');
  s = act(s, 'cast', {
    card: spell.id,
    targets: { destroyed: [ref(enemy)], recipient: [ref(own)] },
  });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
  assert.deepEqual(aura(s, 'Wicked').attachedTo, ref(s.objects[own.id]));
  assert.equal(stats(s, s.objects[own.id]).power, 3);
});
test('Shatter the Oath cannot attach its Role to the creature it has just destroyed', () => {
  let s = fixture();
  lands(s, 'Swamp', 5);
  const own = put(s, 'Grizzly Bears'),
    spell = put(s, 'Shatter the Oath', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { destroyed: [ref(own)], recipient: [ref(own)] } });
  s = resolve(s);
  assert.equal(s.objects[own.id].zone, 'graveyard');
  assert(!aura(s, 'Wicked'));
});
test('Splashy Spellcaster allows no target or another creature and grants that creature the scry attack trigger', () => {
  let s = fixture();
  const splash = put(s, 'Splashy Spellcaster'),
    bear = put(s, 'Grizzly Bears'),
    spell = put(s, 'Opt', 0, 'hand');
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: spell.id });
  assert.throws(() => act(s, 'chooseTriggerTargets', { targets: { recipient: [ref(splash)] } }));
  s = act(s, 'chooseTriggerTargets', { targets: { recipient: [ref(bear)] } });
  s = resolve(s);
  assert.deepEqual(aura(s, 'Sorcerer').attachedTo, ref(s.objects[bear.id]));
  notifyTriggers(s, 'attack', { object: s.objects[bear.id] });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
});
test('The Witch’s Vanity chapters destroy cheap opposing creatures, make Food, then attach Wicked', () => {
  let s = fixture();
  const enemy = put(s, 'Grizzly Bears', 1),
    own = put(s, 'Grizzly Bears');
  const saga = enter(s, "The Witch's Vanity");
  s = act(s, 'chooseTriggerTarget', { target: ref(enemy) });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
  notifyTriggers(s, 'chapter', { object: s.objects[saga.id], chapterNumber: 2 });
  stabilize(s);
  s = resolve(s);
  assert(aura(s, 'Food Token'));
  notifyTriggers(s, 'chapter', { object: s.objects[saga.id], chapterNumber: 3 });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(own) });
  s = resolve(s);
  assert.deepEqual(aura(s, 'Wicked').attachedTo, ref(s.objects[own.id]));
});
test('Shatter the Oath preserves either independent legal target when the other leaves', () => {
  for (const missing of ['destroyed', 'recipient']) {
    let s = fixture();
    lands(s, 'Swamp', 5);
    const enemy = put(s, 'Grizzly Bears', 1),
      own = put(s, 'Grizzly Bears'),
      spell = put(s, 'Shatter the Oath', 0, 'hand');
    s = act(s, 'cast', {
      card: spell.id,
      targets: { destroyed: [ref(enemy)], recipient: [ref(own)] },
    });
    move(s, s.objects[missing === 'destroyed' ? enemy.id : own.id], 'exile');
    s = resolve(s);
    if (missing === 'destroyed')
      assert.deepEqual(aura(s, 'Wicked').attachedTo, ref(s.objects[own.id]));
    else {
      assert.equal(s.objects[enemy.id].zone, 'graveyard');
      assert(!aura(s, 'Wicked'));
    }
  }
});
