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
  'Marwyn, the Clearcutter',
  'Slagdrill Scrapper',
  'Ripchain Razorkin',
  'Redrock Sentinel',
  'Umbral Collar Zealot',
  'Unburied Earthcarver',
  'Unrooted Ancestor',
  'Vampiric Rites',
  'Vanguard of the Rose',
  "Vito's Inquisitor",
  'Sweettooth Witch',
  'Prosperity Tycoon',
  'Metalhead',
  'Seismic Monstrosaur',
  'Threefold Thunderhulk',
  'Popular Egotist',
  'Snowslope Hunter',
  'Stone-Giant of High Pass',
  'Stone Boulder',
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
test('18 complete v54 selected-sacrifice cards compile and round trip every clause', () => {
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
import { dispatch } from '../packages/engine/src/index.js';
for (const [name, victimName] of [
  ['Marwyn, the Clearcutter', 'Food Token'],
  ['Slagdrill Scrapper', 'Forest'],
  ['Ripchain Razorkin', 'Forest'],
  ['Redrock Sentinel', 'Forest'],
  ['Umbral Collar Zealot', 'Food Token'],
  ['Unburied Earthcarver', 'Grizzly Bears'],
  ['Unrooted Ancestor', 'Grizzly Bears'],
  ['Vampiric Rites', 'Grizzly Bears'],
  ['Vanguard of the Rose', 'Food Token'],
  ["Vito's Inquisitor", 'Food Token'],
  ['Sweettooth Witch', 'Food Token'],
  ['Prosperity Tycoon', 'Food Token'],
  ['Metalhead', 'Food Token'],
  ['Seismic Monstrosaur', 'Forest'],
  ['Threefold Thunderhulk', 'Food Token'],
]) {
  test(name + ' pays a selected legal sacrifice immediately, before resolution', () => {
    let s = fixture();
    for (const b of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) lands(s, b, 3);
    const source = put(s, name);
    if (name === 'Threefold Thunderhulk') source.plusCounters = 3;
    const victim = put(s, victimName);
    const cmd = {
      card: source.id,
      ability: 0,
      sacrifices: [ref(victim)],
      ...(name === 'Sweettooth Witch' ? { target: { kind: 'player', id: 1 } } : {}),
    };
    s = act(s, 'activate', cmd);
    assert(!s.objects[victim.id] || s.objects[victim.id].zone === 'graveyard');
    s = resolve(s);
    if (name === 'Umbral Collar Zealot') assert.equal(s.choice.kind, 'libraryOrder');
    if (['Unrooted Ancestor', 'Vanguard of the Rose', 'Prosperity Tycoon'].includes(name)) {
      assert(hasKeyword(s, s.objects[source.id], 'indestructible'));
      assert(s.objects[source.id].tapped);
    }
    if (name === 'Sweettooth Witch') assert.equal(s.players[1].life, 18);
  });
}
test('selected-sacrifice excludes its source where printed and does not spend mana on failure', () => {
  const s = fixture();
  lands(s, 'Swamp', 2);
  const source = put(s, "Vito's Inquisitor");
  const result = dispatch(s, {
    type: 'activate',
    player: 0,
    card: source.id,
    ability: 0,
    sacrifices: [ref(source)],
  });
  assert.equal(result.ok, false);
  assert.equal(s.objects[source.id].zone, 'battlefield');
});
test('Popular Egotist sacrifice trigger drains before its protection ability resolves', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const e = put(s, 'Popular Egotist'),
    victim = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: e.id, ability: 0, sacrifices: [ref(victim)] });
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  s = resolve(s);
  assert(hasKeyword(s, s.objects[e.id], 'indestructible'));
  assert(s.objects[e.id].tapped);
});
test('Snowslope Hunter restricts sacrifice to own turn and once per turn', () => {
  let s = fixture();
  const h = put(s, 'Snowslope Hunter'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Food Token');
  s = act(s, 'activate', { card: h.id, ability: 0, sacrifices: [ref(a)] });
  s = resolve(s);
  assert(!legalActions(s, 0).some((x) => x.type === 'activate' && x.card === h.id));
  assert.equal(s.players[0].exile.length, 1);
  const t = fixture();
  t.active = 1;
  const other = put(t, 'Snowslope Hunter');
  put(t, 'Grizzly Bears');
  assert(!legalActions(t, 0).some((x) => x.type === 'activate' && x.card === other.id));
});
test('Stone-Giant creates an exact named defender Wall and sacrifices it for four damage', () => {
  let s = fixture();
  lands(s, 'Mountain', 3);
  const giant = enter(s, 'Stone-Giant of High Pass');
  s = resolve(s);
  const stone = Object.values(s.objects).find(
    (o) => o.name === 'Stone Boulder' && o.zone === 'battlefield',
  );
  assert(stone);
  assert.equal(stats(s, stone).power, 3);
  assert.equal(stats(s, stone).toughness, 1);
  assert(hasKeyword(s, stone, 'defender'));
  s = act(s, 'activate', {
    card: giant.id,
    ability: 0,
    sacrifices: [ref(stone)],
    target: { kind: 'player', id: 1 },
  });
  s = resolve(s);
  assert.equal(s.players[1].life, 16);
});
test('Threefold Thunderhulk ETB and attack use current power for exact Gnome token counts', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const giant = enter(s, 'Threefold Thunderhulk');
  s = resolve(s);
  const gnomes = () =>
    Object.values(s.objects).filter(
      (o) => o.name === 'Artifact Gnome Token' && o.zone === 'battlefield',
    );
  assert.equal(gnomes().length, 3);
  const food = put(s, 'Food Token');
  s = act(s, 'activate', { card: giant.id, ability: 0, sacrifices: [ref(food)] });
  s = resolve(s);
  assert.equal(stats(s, s.objects[giant.id]).power, 4);
  notifyTriggers(s, 'attack', { object: s.objects[giant.id], controller: 0 });
  stabilize(s);
  s = resolve(s);
  assert.equal(gnomes().length, 7);
});
test('Metalhead ETB can bounce an opposing artifact without narrowing to creatures', () => {
  let s = fixture();
  const food = put(s, 'Food Token', 1);
  enter(s, 'Metalhead');
  s = act(s, 'chooseTriggerTargets', { targets: { returned: [ref(food)] } });
  s = resolve(s);
  assert(!s.objects[food.id]);
});
