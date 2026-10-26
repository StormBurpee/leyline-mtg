import {
  createGame,
  dispatch,
  exportReplay,
  legalActions,
  playerView,
} from '../engine/src/index.js';
import { freezeRecord } from '../engine/src/model.js';

/** A local agent boundary, not a sandbox for untrusted JavaScript. */
export function createSession(config = {}) {
  let state = createGame(config);
  const perspectives = [0, 1].map(() => ({ next: 0, outward: new Map(), inward: new Map() }));
  function context() {
    if (state.status === 'finished') return null;
    const player = state.choice?.player ?? state.priority;
    const perspective = perspectives[player];
    const view = playerView(state, player, { includeEvents: false });
    // No concealed object handles, deck-order IDs, RNG, history or event traces.
    // The engine's UI view is intentionally richer than an agent observation.
    delete view.nextId;
    delete view.eventSeq;
    delete view.events;
    delete view.pendingTriggers;
    for (const p of view.players) {
      p.libraryCount = p.library.length;
      delete p.library;
      p.handCount = p.hand.length;
      if (p.id !== player) delete p.hand;
    }
    const visible = Object.values(view.objects).filter((o) => !o.hidden && o.zone !== 'void');
    const names = new Set([
      ...visible.map((o) => o.name),
      ...view.stack.map((e) => e.name),
      ...(view.resolving ? [view.resolving.entry.name] : []),
      ...(view.choice?.entry ? [view.choice.entry.name] : []),
    ]);
    view.catalog = Object.fromEntries([...names].map((name) => [name, state.catalog[name]]));
    const ids = new Map();
    // Assign handles in observed-zone order rather than original deck construction order.
    const order = [
      ...state.players[player].hand,
      ...(state.choice?.player === player && state.choice.kind === 'libraryOrder'
        ? state.choice.cards
        : []),
      ...(state.choice?.player === player && state.choice.kind === 'librarySearch'
        ? [...state.players[player].library].sort((a, b) =>
            state.objects[a].name.localeCompare(state.objects[b].name),
          )
        : []),
      ...state.stack.map((e) => e.source?.id).filter(Boolean),
      ...state.players.flatMap((p) => [...p.graveyard, ...p.exile]),
      ...visible.filter((o) => o.zone === 'hand').map((o) => o.id),
      ...visible.filter((o) => o.zone === 'battlefield').map((o) => o.id),
    ];
    const allowed = new Set(visible.map((o) => o.id));
    for (const id of order) {
      if (!allowed.has(id) || ids.has(id)) continue;
      const object = state.objects[id],
        identity = `${id}:${object.incarnation}`;
      if (!perspective.outward.has(identity))
        perspective.outward.set(identity, `object:${++perspective.next}`);
      const handle = perspective.outward.get(identity);
      ids.set(id, handle);
    }
    perspective.inward = new Map([...ids].map(([id, handle]) => [handle, id]));
    function redact(value, key = '') {
      if (['catalog', 'name', 'text', 'label'].includes(key)) return value;
      if (typeof value === 'string') return ids.get(value) ?? value;
      if (Array.isArray(value)) return value.map((v) => redact(v));
      if (
        value &&
        typeof value === 'object' &&
        value.kind === 'object' &&
        typeof value.id === 'string'
      ) {
        const identity = `${value.id}:${value.incarnation}`;
        if (!perspective.outward.has(identity))
          perspective.outward.set(identity, `object:${++perspective.next}`);
        return { ...value, id: perspective.outward.get(identity) };
      }
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [ids.get(k) ?? k, redact(v, k)]),
        );
      return value;
    }
    view.objects = Object.fromEntries(visible.filter((o) => ids.has(o.id)).map((o) => [o.id, o]));
    // Pending choices may include a previous player's private damage allocation.
    if (view.choice) {
      delete view.choice.remaining;
      delete view.choice.remainingEntries;
      delete view.choice.packets;
    }
    const observation = redact(view);
    const actions = redact(legalActions(state, player)).map((a) => ({ ...a, player }));
    return freezeRecord({
      schemaVersion: 1,
      player,
      revision: state.revision,
      observation,
      actions,
    });
  }
  function step(command) {
    if (!command || typeof command !== 'object')
      return { ok: false, error: { code: 'AGENT_COMMAND', message: 'Expected a command object.' } };
    const player = state.choice?.player ?? state.priority;
    if (command.player !== player)
      return {
        ok: false,
        error: { code: 'AGENT_PLAYER', message: 'The command must belong to the current actor.' },
      };
    const map = perspectives[player].inward;
    const handle = (value) => {
      if (!map.has(value)) throw new Error('Unknown or concealed object handle.');
      return map.get(value);
    };
    function decode(value, key = '') {
      if (
        ['card', 'blocker', 'attacker', 'discardCard'].includes(key) ||
        (key === 'source' && typeof value === 'string')
      )
        return value === null ? null : handle(value);
      if (['cards', 'top', 'rest'].includes(key)) {
        if (!Array.isArray(value)) throw new Error('Expected a list of object handles.');
        return value.map(handle);
      }
      if (Array.isArray(value)) return value.map((v) => decode(v));
      if (value && typeof value === 'object') {
        const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v, k)]));
        if (value.kind === 'object') result.id = handle(value.id);
        return result;
      }
      return value;
    }
    let decoded;
    try {
      decoded = decode(command);
    } catch (e) {
      return { ok: false, error: { code: 'AGENT_HANDLE', message: e.message } };
    }
    const result = dispatch(state, {
      ...decoded,
      expectedRevision: command.expectedRevision ?? state.revision,
    });
    if (!result.ok) return { ok: false, error: result.error };
    state = result.state;
    return { ok: true, revision: state.revision, terminal: state.status === 'finished' };
  }
  return Object.freeze({
    context,
    step,
    summary: () => ({
      engineVersion: state.version,
      status: state.status,
      winner: state.winner,
      turn: state.turn,
      decisions: state.history.length,
    }),
    // Privileged evaluation artifact. Never include this in a policy's context.
    exportReplay: () => exportReplay(state),
  });
}
