import { exportReplay } from '../../packages/engine/src/index.js';

export const MATCH_SAVE_KEY = 'leyline.match.v1';
const CATALOG_PREFIX = 'leyline.match-catalog.v1.';
const catalogKey = (value) =>
  typeof value === 'string' && /^leyline\.match-catalog\.v1\.[a-f0-9]{16}$/.test(value);

// A deterministic corruption checksum, not an authentication/security boundary.
// Writes also require exact JSON equality before reusing a content-addressed key.
function checksum(json) {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return [a, b].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}
const matchesKey = (key, json) => catalogKey(key) && key === CATALOG_PREFIX + checksum(json);

/** Local storage only: runtime catalogs and exported replays stay complete.
 * Persist exact immutable definitions once, then commit small command/UI snapshots.
 * Never discard the previous catalog before its replacement snapshot is durable.
 */
export function createMatchStorage(getStorage = () => localStorage) {
  let cachedCatalog = null,
    cachedJSON = null,
    cachedKey = null;
  function snapshot(storage) {
    try {
      return JSON.parse(storage.getItem(MATCH_SAVE_KEY) ?? 'null');
    } catch (error) {
      // A corrupt snapshot may be replaced. Inaccessible storage must fail.
      if (!(error instanceof SyntaxError)) throw error;
      return null;
    }
  }
  return {
    hasSave() {
      try {
        return getStorage().getItem(MATCH_SAVE_KEY) !== null;
      } catch {
        return false;
      }
    },
    read() {
      const storage = getStorage();
      const saved = JSON.parse(storage.getItem(MATCH_SAVE_KEY) ?? 'null');
      if (!saved || saved.storageVersion === undefined) return saved;
      if (saved.storageVersion !== 1 || !catalogKey(saved.catalogKey))
        throw new Error('The saved match has an unsupported storage format.');
      const json = storage.getItem(saved.catalogKey);
      if (json === null) throw new Error('The saved match is missing its card definitions.');
      if (!matchesKey(saved.catalogKey, json))
        throw new Error('The saved match has damaged card definitions.');
      const catalog = JSON.parse(json);
      if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
        throw new Error('The saved match has invalid card definitions.');
      if (!saved.replay?.config || saved.replay.config.catalog !== null)
        throw new Error('The saved match has invalid replay settings.');
      return { ...saved, replay: { ...saved.replay, config: { ...saved.replay.config, catalog } } };
    },
    write(state, settings) {
      const storage = getStorage();
      const previous = snapshot(storage);
      if (cachedCatalog !== state.config.catalog) {
        cachedJSON = JSON.stringify(state.config.catalog);
        cachedKey = CATALOG_PREFIX + checksum(cachedJSON);
        cachedCatalog = state.config.catalog;
      }
      const key = cachedKey;
      const existing = storage.getItem(key);
      if (existing !== null && existing !== cachedJSON)
        throw new Error('Stored card definitions conflict with this match.');
      const needsCatalog = existing === null;
      // exportReplay owns its version/rules envelope. Omit only the catalog in
      // this private local representation; seed, decks and other config stay inline.
      // null makes older clients fail closed rather than substituting CARDS when
      // they attempt to replay this private snapshot without loading its catalog.
      const record = exportReplay({ ...state, config: { ...state.config, catalog: null } });
      const json = JSON.stringify({
        ...settings,
        storageVersion: 1,
        catalogKey: key,
        replay: record,
      });
      try {
        if (needsCatalog) storage.setItem(key, cachedJSON);
        storage.setItem(MATCH_SAVE_KEY, json);
      } catch (error) {
        if (needsCatalog) {
          try {
            if (storage.getItem(key) === cachedJSON && snapshot(storage)?.catalogKey !== key)
              storage.removeItem(key);
          } catch {}
        }
        throw error;
      }
      if (catalogKey(previous?.catalogKey) && previous.catalogKey !== key) {
        try {
          // Do not remove another tab's current catalog or an unrelated/corrupt key.
          const old = storage.getItem(previous.catalogKey);
          if (
            old !== null &&
            matchesKey(previous.catalogKey, old) &&
            storage.getItem(MATCH_SAVE_KEY) === json
          )
            storage.removeItem(previous.catalogKey);
        } catch {}
      }
    },
  };
}
