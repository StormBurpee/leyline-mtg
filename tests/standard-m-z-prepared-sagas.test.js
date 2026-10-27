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
  'Maelstrom Artisan // Rocket Volley',
  'Quill-Blade Laureate // Twofold Intent',
  'Semester Foreseer // Peer Review',
  'Spellbook Seeker // Careful Study',
  'Studious First-Year // Rampant Growth',
  'Theorix Metamage // Omit Variables',
  'Void Extrapolator // Omit Variables',
  'Sanar, Unfinished Genius // Wild Idea',
  'Strife Scholar // Awaken the Ages',
  'Summon: G.F. Ifrit',
  'Summon: Primal Garuda',
  'The Cave of Two Lovers',
  'Red White Spirit Token',
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
          `../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('Nine prepared cards, three Sagas and one exact Spirit token compile and round trip every clause', () => {
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
import { definition, notifyTriggers } from '../packages/engine/src/model.js';
function enter(s, name) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  return o;
}
test('all nine full prepared sources enter with their actual spell copy, not a placeholder', () => {
  for (const name of names.filter((n) => n.includes(' // '))) {
    const s = fixture();
    put(s, 'Torpor Orb');
    const o = enter(s, name);
    assert(o.preparedCopy, name);
    const copy = s.objects[o.preparedCopy.id];
    assert.equal(copy.name, name.split(' // ')[1]);
    assert.equal(copy.zone, 'exile');
    assert.equal(definition(s, o).name, name.split(' // ')[0]);
  }
});
test('Maelstrom prepared spell destroys a nonbasic land and consumes only the prepared copy', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const source = enter(s, 'Maelstrom Artisan // Rocket Volley');
  stabilize(s);
  const target = put(s, 'Soured Springs', 1);
  const copy = s.objects[source.preparedCopy.id];
  s = act(s, 'cast', { card: copy.id, target: ref(target) });
  assert.equal(s.objects[source.id].preparedCopy, undefined);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.objects[source.id].zone, 'battlefield');
  assert.equal(s.objects[copy.id], undefined);
});
test('Studious First-Year prepared Rampant Growth finds a basic and enters it tapped', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const source = enter(s, 'Studious First-Year // Rampant Growth');
  stabilize(s);
  s = act(s, 'cast', { card: source.preparedCopy.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  const id = s.choice.cards[0];
  s = act(s, 'searchLibrary', { cards: [id] });
  assert.equal(s.objects[id].zone, 'battlefield');
  assert.equal(s.objects[id].tapped, true);
});
test('Sanar activation needs an instant or sorcery cast, not an arbitrary permanent spell', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  const sanar = put(s, 'Sanar, Unfinished Genius // Wild Idea');
  assert(!legalActions(s, 0).some((a) => a.type === 'activate' && a.card === sanar.id));
  const spell = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  assert(legalActions(s, 0).some((a) => a.type === 'activate' && a.card === sanar.id));
});
test('both Omit Variables creatures keep distinct threshold bonuses despite sharing a prepared spell name', () => {
  const s = fixture();
  const a = put(s, 'Theorix Metamage // Omit Variables'),
    b = put(s, 'Void Extrapolator // Omit Variables');
  const baseA = stats(s, a),
    baseB = stats(s, b);
  for (let i = 0; i < 7; i++) put(s, 'Forest', 0, 'graveyard');
  assert.equal(stats(s, a).power, baseA.power + 1);
  assert.equal(stats(s, a).toughness, baseA.toughness);
  assert(hasKeyword(s, a, 'flying'));
  assert.equal(stats(s, b).power, baseB.power + 1);
  assert.equal(stats(s, b).toughness, baseB.toughness + 1);
});
test('Primal Garuda chapter II cannot target itself but grants another creature flying', () => {
  let s = fixture();
  const saga = put(s, 'Summon: Primal Garuda');
  saga.loreCounters = 2;
  const ally = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'chapter', { object: saga, chapterNumber: 2 });
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.deepEqual(s.choice.targets, [ref(ally)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(ally) });
  s = resolve(s);
  assert(hasKeyword(s, s.objects[ally.id], 'flying'));
  assert.equal(stats(s, s.objects[ally.id]).power, 3);
});
test('Cave saga chapter I makes two Allies and chapter III establishes earthbend return behavior', () => {
  let s = fixture();
  const saga = enter(s, 'The Cave of Two Lovers');
  stabilize(s);
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Ally Token')
      .length,
    2,
  );
  const land = put(s, 'Forest');
  s.objects[saga.id].loreCounters = 3;
  notifyTriggers(s, 'chapter', { object: s.objects[saga.id], chapterNumber: 3 });
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[land.id]).power, 3);
  assert(hasKeyword(s, s.objects[land.id], 'haste'));
  assert.equal(s.objects[saga.id].zone, 'graveyard');
});
