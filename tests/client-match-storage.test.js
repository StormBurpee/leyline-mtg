import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchStorage, MATCH_SAVE_KEY } from '../apps/web/match-storage.js';
import { META_DECKS } from '../apps/web/meta-decks.js';
import { REQUESTED_DECKS } from '../apps/web/requested-decks.js';
import {
  CARDS,
  createGame,
  chooseBotCommand,
  dispatch,
  expandDeck,
  exportReplay,
  replay,
  playerView,
} from '../packages/engine/src/index.js';
import { createSession } from '../packages/simulation/session.js';

function fixture() {
  const values = new Map(),
    writes = [];
  let fail = () => false;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (fail(key)) throw new Error('Quota exceeded');
      values.set(key, value);
      writes.push({ key, bytes: Buffer.byteLength(value) });
    },
    removeItem: (key) => values.delete(key),
  };
  return {
    values,
    writes,
    storage,
    store: createMatchStorage(() => storage),
    fail: (fn) => {
      fail = fn;
    },
  };
}
const settings = { mode: 'bot', deck: 'storm-rakdos', controls: { handExpanded: true } };
function act(state) {
  const command = chooseBotCommand(state, state.choice?.player ?? state.priority);
  assert.ok(command);
  const result = dispatch(state, command);
  assert.ok(result.ok, result.error?.message);
  return result.state;
}

test('only the first save writes full immutable definitions; later snapshots preserve exact replay data', () => {
  const h = fixture();
  let state = createGame();
  const config = state.config;
  h.store.write(state, settings);
  assert.equal(h.writes.length, 2);
  assert.throws(() => replay(JSON.parse(h.values.get(MATCH_SAVE_KEY)).replay), /definitions/);
  assert.deepEqual(h.store.read().replay, exportReplay(state));
  for (let i = 0; i < 30; i++) {
    state = act(state);
    assert.equal(state.config, config);
    const before = h.writes.length;
    h.store.write(state, settings);
    assert.equal(h.writes.length, before + 1);
    assert.equal(h.writes.at(-1).key, MATCH_SAVE_KEY);
    assert.ok(h.writes.at(-1).bytes < 10000);
  }
  assert.equal(h.values.size, 2);
  assert.deepEqual(h.store.read().replay, exportReplay(state));
  assert.deepEqual(replay(h.store.read().replay), state);
  assert.equal(Object.keys(state.catalog).length, Object.keys(CARDS).length);
  assert.equal(state.config.catalog, state.catalog);
});

test('legacy inline saves, custom unused definitions and historical replay envelopes remain exact', () => {
  const h = fixture();
  const custom = { ...CARDS['Grizzly Bears'], name: 'Unused imported custom card', power: 7 };
  const state = createGame({ catalog: { ...CARDS, [custom.name]: custom } });
  const record = exportReplay(state);
  record.version = '0.53.0';
  h.storage.setItem(MATCH_SAVE_KEY, JSON.stringify({ ...settings, replay: record }));
  assert.deepEqual(h.store.read(), { ...settings, replay: record });
  const restored = replay(h.store.read().replay);
  assert.deepEqual(restored, state);
  h.store.write(restored, settings);
  assert.equal(h.values.size, 2);
  assert.deepEqual(h.store.read().replay, exportReplay(restored));
  assert.equal(h.store.read().replay.config.catalog[custom.name].power, 7);
  assert.deepEqual(replay(h.store.read().replay), restored);
});

test('reload and new matches reuse identical catalogs and successful replacement cleans only its predecessor', () => {
  const h = fixture();
  h.store.write(createGame(), settings);
  const first = h.store.read();
  const reloaded = createMatchStorage(() => h.storage);
  const state = replay(reloaded.read().replay);
  const before = h.writes.length;
  reloaded.write(act(state), settings);
  assert.equal(h.writes.length, before + 1);
  assert.equal(reloaded.read().catalogKey, first.catalogKey);
  h.values.set('unrelated-preference', 'keep me');
  reloaded.write(createGame({ seed: 88 }), settings);
  assert.equal(reloaded.read().catalogKey, first.catalogKey);
  reloaded.write(
    createGame({
      catalog: { ...CARDS, 'A replacement card': { ...CARDS.Forest, name: 'A replacement card' } },
    }),
    settings,
  );
  assert.notEqual(reloaded.read().catalogKey, first.catalogKey);
  assert.equal(h.values.has(first.catalogKey), false);
  assert.equal(h.values.get('unrelated-preference'), 'keep me');
  assert.equal(h.values.size, 3);
});

for (const stage of ['catalog', 'snapshot'])
  test(`failed ${stage} write preserves the prior complete save and retry succeeds`, () => {
    const h = fixture();
    const first = createGame();
    h.store.write(first, settings);
    const before = new Map(h.values);
    const next = createGame({
      seed: 99,
      catalog: {
        ...CARDS,
        'Another custom card': { ...CARDS.Forest, name: 'Another custom card' },
      },
    });
    h.fail((key) => (stage === 'snapshot' ? key === MATCH_SAVE_KEY : key !== MATCH_SAVE_KEY));
    assert.throws(() => h.store.write(next, settings), /Quota exceeded/);
    assert.deepEqual(h.values, before);
    assert.deepEqual(replay(h.store.read().replay), first);
    h.fail(() => false);
    h.store.write(next, settings);
    assert.deepEqual(replay(h.store.read().replay), next);
    assert.equal(h.values.size, 2);
  });

test('another tab removing an old catalog does not leave a later save with a dangling reference', () => {
  const h = fixture();
  const first = createGame();
  h.store.write(first, settings);
  const second = createMatchStorage(() => h.storage);
  second.write(
    createGame({
      seed: 2,
      catalog: { ...CARDS, 'A second tab card': { ...CARDS.Forest, name: 'A second tab card' } },
    }),
    settings,
  );
  h.store.write(act(first), settings);
  assert.deepEqual(replay(h.store.read().replay), act(first));
  assert.equal(h.values.size, 2);
});

test('missing or invalid catalogs and unknown save versions fail closed; corrupt snapshots can be replaced', () => {
  const h = fixture();
  h.store.write(createGame(), settings);
  const saved = JSON.parse(h.values.get(MATCH_SAVE_KEY));
  h.values.delete(saved.catalogKey);
  assert.throws(() => h.store.read(), /missing its card definitions/);
  h.values.set(saved.catalogKey, 'null');
  assert.throws(() => h.store.read(), /damaged card definitions/);
  h.values.set(MATCH_SAVE_KEY, JSON.stringify({ ...saved, storageVersion: 99 }));
  assert.throws(() => h.store.read(), /unsupported storage format/);
  assert.throws(() => h.store.write(createGame(), settings), /definitions conflict/);
  h.values.delete(saved.catalogKey);
  h.values.set(MATCH_SAVE_KEY, 'not JSON');
  h.store.write(createGame({ seed: 3 }), settings);
  assert.equal(h.store.read().replay.config.seed, 3);
});

test('full runtime/public catalogs and opaque proposals do not reveal concealed opponent deck membership', () => {
  const own = Array(60).fill('Island');
  const states = ['Forest', 'Mountain'].map((name) =>
    createGame({ decks: [own, Array(60).fill(name)], seed: 7 }),
  );
  const views = [];
  const contexts = [];
  for (const state of states) {
    const h = fixture();
    h.store.write(state, settings);
    const restored = replay(h.store.read().replay);
    views.push(playerView(restored, 0));
    contexts.push(createSession(restored.config).context());
    assert.deepEqual(chooseBotCommand(restored, 0), chooseBotCommand(state, 0));
  }
  assert.deepEqual(views[0], views[1]);
  assert.deepEqual(contexts[0], contexts[1]);
  assert.deepEqual(chooseBotCommand(states[0], 0), chooseBotCommand(states[1], 0));
});

const presets = Object.entries({ ...REQUESTED_DECKS, ...META_DECKS });
for (const [index, [id, deck]] of presets.entries())
  test(`${id}: saved and resumed matches preserve initialization, commands and replay`, () => {
    const h = fixture();
    const decks = [
      expandDeck(deck.cards),
      expandDeck(presets[(index + 1) % presets.length][1].cards),
    ];
    let state = createGame({ decks, seed: 731 + index });
    h.store.write(state, settings);
    assert.deepEqual(replay(h.store.read().replay), state);
    for (let i = 0; i < 100 && state.status !== 'finished'; i++) {
      state = act(state);
      h.store.write(state, settings);
    }
    const restored = replay(h.store.read().replay);
    assert.deepEqual(h.store.read().replay, exportReplay(state));
    assert.deepEqual(restored, state);
    assert.deepEqual(
      chooseBotCommand(restored, restored.choice?.player ?? restored.priority),
      chooseBotCommand(state, state.choice?.player ?? state.priority),
    );
    assert.ok(state.history.some((command) => command.type === 'playLand'));
    assert.ok(state.history.some((command) => command.type === 'cast'));
    assert.equal(h.writes.filter(({ key }) => key !== MATCH_SAVE_KEY).length, 1);
  });

test('storage references cannot read or delete keys outside the exact private checksum namespace', () => {
  const h = fixture();
  h.values.set('unrelated-private-key', 'keep this');
  for (const key of [
    'unrelated-private-key',
    'leyline.match-catalog.v1.not-a-checksum',
    'leyline.match-catalog.v1.0123456789abcdef.extra',
  ]) {
    h.values.set(
      MATCH_SAVE_KEY,
      JSON.stringify({ storageVersion: 1, catalogKey: key, replay: {} }),
    );
    const reads = [];
    const storage = {
      ...h.storage,
      getItem(name) {
        reads.push(name);
        return h.storage.getItem(name);
      },
    };
    const store = createMatchStorage(() => storage);
    assert.throws(() => store.read(), /unsupported storage format/);
    assert.deepEqual(reads, [MATCH_SAVE_KEY]);
    store.write(createGame(), settings);
    assert.equal(h.values.get('unrelated-private-key'), 'keep this');
    assert.ok(!reads.includes(key));
  }
});

test('catalog corruption fails closed and replacement does not delete unverified prior content', () => {
  const h = fixture();
  const state = createGame();
  h.store.write(state, settings);
  const saved = h.store.read();
  const originalSnapshot = h.values.get(MATCH_SAVE_KEY);
  h.values.set(saved.catalogKey, JSON.stringify({ counterfeit: true }));
  assert.throws(() => h.store.read(), /damaged card definitions/);
  assert.throws(() => h.store.write(act(state), settings), /definitions conflict/);
  assert.equal(h.values.get(MATCH_SAVE_KEY), originalSnapshot);
  h.store.write(
    createGame({
      catalog: { ...CARDS, 'Fresh definition': { ...CARDS.Forest, name: 'Fresh definition' } },
    }),
    settings,
  );
  assert.equal(h.values.get(saved.catalogKey), JSON.stringify({ counterfeit: true }));
});

test('failed inline migration and failed history update retain their previous save without orphaning data', () => {
  const h = fixture();
  const state = createGame();
  h.values.set(MATCH_SAVE_KEY, JSON.stringify({ ...settings, replay: exportReplay(state) }));
  const original = new Map(h.values);
  h.fail((key) => key === MATCH_SAVE_KEY);
  assert.throws(() => h.store.write(act(state), settings), /Quota exceeded/);
  assert.deepEqual(h.values, original);
  h.fail(() => false);
  h.store.write(state, settings);
  const split = new Map(h.values);
  h.fail((key) => key === MATCH_SAVE_KEY);
  assert.throws(() => h.store.write(act(state), settings), /Quota exceeded/);
  assert.deepEqual(h.values, split);
  assert.deepEqual(replay(h.store.read().replay), state);
});

test('unavailable storage is not reported as a saved match', () => {
  const store = createMatchStorage(() => {
    throw new Error('Storage denied');
  });
  assert.equal(store.hasSave(), false);
  assert.throws(() => store.read(), /Storage denied/);
  assert.throws(() => store.write(createGame(), settings), /Storage denied/);
});
