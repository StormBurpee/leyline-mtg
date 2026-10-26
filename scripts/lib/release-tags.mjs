export function validateCheckpoint(checkpoint) {
  if (
    !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(checkpoint.tag) ||
    !/^[a-f0-9]{40}$/.test(checkpoint.sha) ||
    !Number.isSafeInteger(checkpoint.runId) ||
    checkpoint.runId < 1
  )
    throw new Error('Invalid release checkpoint.');
}
export function validateEvidence(checkpoint, run, packageVersion, repository) {
  validateCheckpoint(checkpoint);
  if (
    run.id !== checkpoint.runId ||
    run.head_sha !== checkpoint.sha ||
    run.head_branch !== 'main' ||
    run.event !== 'push' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository
  )
    throw new Error(`No successful trusted main-branch CI evidence for ${checkpoint.tag}.`);
  if (`v${packageVersion}` !== checkpoint.tag)
    throw new Error(`Package version disagrees with ${checkpoint.tag}.`);
}
async function tagCommit(api, ref) {
  if (ref.object.type === 'commit') return ref.object.sha;
  if (ref.object.type !== 'tag') throw new Error('Existing tag does not identify a commit.');
  const tag = await api('GET', `/git/tags/${ref.object.sha}`);
  if (tag.object.type !== 'commit') throw new Error('Nested or non-commit tag is not supported.');
  return tag.object.sha;
}
/** Never updates or deletes a reference. A conflicting checkpoint requires human review. */
export async function ensureVersionTag(api, checkpoint, { preserveExisting = false } = {}) {
  validateCheckpoint(checkpoint);
  const path = `/git/ref/tags/${checkpoint.tag}`;
  const existing = await api('GET', path, undefined, { missing: true });
  if (existing) {
    const sha = await tagCommit(api, existing);
    if (sha !== checkpoint.sha && !preserveExisting)
      throw new Error(`Refusing to move existing ${checkpoint.tag}.`);
    return {
      tag: checkpoint.tag,
      sha,
      status: sha === checkpoint.sha ? 'already_tagged' : 'preserved',
    };
  }
  const object = await api('POST', '/git/tags', {
    tag: checkpoint.tag,
    message: `Leyline ${checkpoint.tag}\n\nTested development checkpoint. CI run ${checkpoint.runId}.\nSee CHANGELOG.md for scope and remaining limitations.`,
    object: checkpoint.sha,
    type: 'commit',
  });
  try {
    await api('POST', '/git/refs', { ref: `refs/tags/${checkpoint.tag}`, sha: object.sha });
  } catch (error) {
    // An uncertain response or concurrent creator must be reconciled, never force-pushed.
    const actual = await api('GET', path, undefined, { missing: true });
    if (!actual || (await tagCommit(api, actual)) !== checkpoint.sha) throw error;
  }
  const verified = await api('GET', path);
  if ((await tagCommit(api, verified)) !== checkpoint.sha)
    throw new Error('Tag verification failed.');
  return { tag: checkpoint.tag, sha: checkpoint.sha, status: 'created' };
}
