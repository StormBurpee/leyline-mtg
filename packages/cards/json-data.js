/** Bound compiler input without executing getters or accepting cyclic/non-JSON values. */
export function jsonDataProblem(value) {
  let nodes = 0;
  const visiting = new Set();
  function check(v, depth) {
    if (++nodes > 20000 || depth > 32) return 'JSON data exceeds the compiler complexity budget.';
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? null : 'JSON numbers must be finite.';
    if (typeof v !== 'object') return 'Only JSON data is accepted.';
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
      return 'Only plain JSON objects are accepted.';
    if (visiting.has(v)) return 'Cyclic data is not accepted.';
    if (Object.getOwnPropertySymbols(v).length) return 'Symbol properties are not JSON data.';
    visiting.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const key of Object.keys(v)) {
      const d = descriptors[key];
      if (d.get || d.set) return 'Accessors are not JSON data.';
      const error = check(d.value, depth + 1);
      if (error) return error;
    }
    visiting.delete(v);
    return null;
  }
  return check(value, 0);
}
