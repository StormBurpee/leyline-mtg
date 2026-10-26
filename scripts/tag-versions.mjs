import { readFile, appendFile } from 'node:fs/promises';
import { validateEvidence, ensureVersionTag, existingVersionTag } from './lib/release-tags.mjs';
const repository = process.env.GITHUB_REPOSITORY;
if (repository !== 'StormBurpee/leyline-mtg' || !process.env.GITHUB_TOKEN)
  throw new Error('Run this only in the authorized repository tagging workflow.');
const api = async (method, path, body, { missing = false } = {}) => {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status}`);
  return response.json();
};
const current = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const checkpoints = [
  { tag: 'v0.1.0', sha: '5c0b02763ed5f4199b0a2da7cdf12bab0b267d6d', runId: 40246368131 },
  { tag: 'v0.2.0', sha: '0dabeec661c589484bc40e00320295708b2b6499', runId: 40249640898 },
  { tag: 'v0.3.0', sha: '6200357202244252624814699af69b1ef612bf9b', runId: 40252349619 },
];
const head = {
  tag: `v${current.version}`,
  sha: process.env.TESTED_SHA,
  runId: Number(process.env.TESTED_RUN_ID),
};
if (!checkpoints.some((c) => c.tag === head.tag)) checkpoints.push(head);
const results = [];
for (const checkpoint of checkpoints) {
  const options = { preserveExisting: checkpoint === head };
  const existing = await existingVersionTag(api, checkpoint, options);
  if (existing) {
    results.push(existing);
    continue;
  }

  const run = await api('GET', `/actions/runs/${checkpoint.runId}`);
  const file = await api('GET', `/contents/package.json?ref=${checkpoint.sha}`);
  const version = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')).version;
  validateEvidence(checkpoint, run, version, repository);
  results.push(await ensureVersionTag(api, checkpoint, options));
}
for (const result of results) console.log(`${result.tag}: ${result.status} at ${result.sha}`);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    results.map((r) => `- ${r.tag}: ${r.status} at ${r.sha}`).join('\n') + '\n',
  );
