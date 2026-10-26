import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCheckpoint,
  validateEvidence,
  ensureVersionTag,
} from '../scripts/lib/release-tags.mjs';
const checkpoint = { tag: 'v0.3.0', sha: 'a'.repeat(40), runId: 5 };
const run = {
  id: 5,
  head_sha: checkpoint.sha,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/ci.yml',
  repository: { full_name: 'owner/repo' },
  head_repository: { full_name: 'owner/repo' },
};
test('tag evidence requires the exact successful trusted push and package version', () => {
  assert.doesNotThrow(() => validateEvidence(checkpoint, run, '0.3.0', 'owner/repo'));
  for (const change of [
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { head_branch: 'feature' },
    { head_sha: 'b'.repeat(40) },
    { head_repository: { full_name: 'fork/repo' } },
    { path: '.github/workflows/unrelated.yml' },
  ])
    assert.throws(() => validateEvidence(checkpoint, { ...run, ...change }, '0.3.0', 'owner/repo'));
  assert.throws(() => validateEvidence(checkpoint, run, '0.4.0', 'owner/repo'));
});
test('unsafe tag names and malformed commit IDs fail before API calls', () => {
  for (const c of [
    { ...checkpoint, tag: 'main' },
    { ...checkpoint, tag: 'v1.2.3/other' },
    { ...checkpoint, sha: 'main' },
    { ...checkpoint, runId: NaN },
  ])
    assert.throws(() => validateCheckpoint(c));
});
function mock(existing = null, { conflict = false } = {}) {
  let ref = existing;
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/git/ref/')) return ref;
    if (method === 'GET' && path === '/git/tags/tag-object')
      return { object: { type: 'commit', sha: checkpoint.sha } };
    if (method === 'POST' && path === '/git/tags') return { sha: 'tag-object' };
    if (method === 'POST' && path === '/git/refs') {
      ref = { object: { type: 'tag', sha: 'tag-object' } };
      if (conflict) throw new Error('uncertain response');
      return ref;
    }
    throw new Error('Unexpected call');
  };
  return { api, calls };
}
test('new annotated tags are verified and a rerun is idempotent', async () => {
  const m = mock();
  assert.equal((await ensureVersionTag(m.api, checkpoint)).status, 'created');
  assert.equal((await ensureVersionTag(m.api, checkpoint)).status, 'already_tagged');
  assert.equal(m.calls.filter((c) => c.method === 'POST' && c.path === '/git/refs').length, 1);
  assert.ok(m.calls.every((c) => !['PATCH', 'DELETE'].includes(c.method)));
});
test('existing conflicting tags are never moved', async () => {
  const m = mock({ object: { type: 'commit', sha: 'b'.repeat(40) } });
  await assert.rejects(ensureVersionTag(m.api, checkpoint), /Refusing to move/);
  assert.equal(m.calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(
    (await ensureVersionTag(m.api, checkpoint, { preserveExisting: true })).status,
    'preserved',
  );
});
test('uncertain tag creation is reconciled with a read rather than retried', async () => {
  const m = mock(null, { conflict: true });
  assert.equal((await ensureVersionTag(m.api, checkpoint)).status, 'created');
  assert.equal(m.calls.filter((c) => c.method === 'POST' && c.path === '/git/refs').length, 1);
});
