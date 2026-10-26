import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { DECKS, expandDeck } from '../packages/engine/src/index.js';
import { runEpisode } from '../packages/simulation/run.js';
import { summarizePaired } from '../packages/simulation/evaluation.js';
import { chooseBotCommand as current } from '../packages/engine/src/bot.js';
import { chooseBotCommand as released } from '../tests/fixtures/v0.22-policy/bot.js';
import { chooseBotCommand as legacy } from '../tests/fixtures/pre-tactical-policy.js';

const policies = { current, released, legacy };
const entries = {
  current: '../packages/engine/src/bot.js',
  released: '../tests/fixtures/v0.22-policy/bot.js',
  legacy: '../tests/fixtures/pre-tactical-policy.js',
};
function identity(name) {
  const files = new Map();
  function visit(url) {
    const path = fileURLToPath(url);
    if (files.has(path)) return;
    const source = readFileSync(url, 'utf8');
    files.set(path, source);
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
      visit(new URL(match[1], url));
  }
  visit(new URL(entries[name], import.meta.url));
  const hash = createHash('sha256');
  // Hash source content in traversal order, independent of checkout location.
  for (const source of files.values()) hash.update(source.replaceAll('\r\n', '\n')).update('\0');
  return { name, sha256: hash.digest('hex'), modules: files.size };
}
async function game(job) {
  const times = [[], []];
  const names =
    job.candidateSeat === 0 ? [job.candidate, job.opponent] : [job.opponent, job.candidate];
  const started = performance.now();
  const result = await runEpisode({
    config: {
      seed: job.seed,
      startingPlayer: job.startingPlayer,
      decks: job.decks.map((d) => expandDeck(DECKS[d].cards)),
    },
    maxDecisions: job.maxDecisions,
    policies: names.map((name, seat) => (context) => {
      const start = performance.now();
      try {
        return policies[name](context.observation, context.player);
      } finally {
        times[seat].push(performance.now() - start);
      }
    }),
  });
  return {
    ...job,
    ...result,
    elapsedMs: performance.now() - started,
    policyTiming: times.map((samples, seat) => {
      samples.sort((a, b) => a - b);
      return {
        policy: names[seat],
        calls: samples.length,
        totalMs: samples.reduce((a, b) => a + b, 0),
        p95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0,
        maxMs: samples.at(-1) ?? 0,
      };
    }),
  };
}
if (!isMainThread) {
  parentPort.on('message', async (job) => {
    try {
      parentPort.postMessage(await game(job));
    } catch (error) {
      parentPort.postMessage({
        ...job,
        termination: 'evaluation_error',
        winner: null,
        error: { message: String(error.stack ?? error) },
      });
    }
  });
} else {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const at = arg.indexOf('=');
      if (!arg.startsWith('--') || at < 0) throw new Error('Use --name=value options.');
      return [arg.slice(2, at), arg.slice(at + 1)];
    }),
  );
  const candidate = args.candidate ?? 'current',
    opponent = args.opponent ?? 'released';
  if (!policies[candidate] || !policies[opponent]) throw new Error('Unknown policy');
  const decks = args.decks ? args.decks.split(',') : Object.keys(DECKS);
  const seeds = (args.seeds ?? '11,38,731').split(',').map(Number);
  const starts = args.starting === '0' ? [0] : args.starting === '1' ? [1] : [0, 1];
  const workers = Number(args.workers ?? 2),
    maxDecisions = Number(args.maxDecisions ?? 3000),
    maxEpisodeMs = Number(args.maxEpisodeMs ?? 300000);
  if (
    !Number.isInteger(workers) ||
    workers < 1 ||
    workers > 16 ||
    !Number.isSafeInteger(maxDecisions) ||
    maxDecisions < 1 ||
    maxDecisions > 10000 ||
    !Number.isSafeInteger(maxEpisodeMs) ||
    maxEpisodeMs < 1 ||
    !decks.length ||
    new Set(decks).size !== decks.length ||
    !seeds.length ||
    new Set(seeds).size !== seeds.length ||
    decks.some((d) => !DECKS[d]) ||
    seeds.some((s) => !Number.isSafeInteger(s) || s < 0 || s > 0xffffffff) ||
    (args.suite && !['mirror', 'mixed'].includes(args.suite)) ||
    (args.starting && !['0', '1', 'both'].includes(args.starting))
  )
    throw new Error('Invalid experiment options');
  const matchups = decks.map((d) => [d, d]);
  if (args.suite === 'mixed')
    decks.forEach((d, i) => matchups.push([d, decks[(i + 1) % decks.length]]));
  const jobs = [];
  for (const ds of matchups)
    for (const seed of seeds)
      for (const startingPlayer of starts) {
        const pair = `${ds.join('/')}:${seed}:${startingPlayer}`;
        for (const candidateSeat of [0, 1])
          jobs.push({
            pair,
            decks: ds,
            seed,
            startingPlayer,
            candidateSeat,
            candidate,
            opponent,
            maxDecisions,
          });
      }
  const path = resolve(args.output ?? 'bot-evaluation.jsonl');
  mkdirSync(dirname(path), { recursive: true });
  const metadata = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    policies: [identity(candidate), identity(opponent)],
    workers,
    node: process.version,
    platform: process.platform,
    budgets: {
      maxDecisions,
      maxEpisodeMs,
      policies: Object.fromEntries(
        [candidate, opponent].map((name) => [
          name,
          name === 'legacy'
            ? { search: false }
            : {
                blockers: 1400,
                attackResponse: 96,
                counterattack: 64,
                mainPhaseNodes: name === 'current' ? 256 : 0,
                mainPhaseDepth: name === 'current' ? 4 : 0,
                mainPhaseCandidates: name === 'current' ? 24 : 0,
              },
        ]),
      ),
    },
    options: args,
    games: jobs.length,
  };
  // Refuse accidental overwrites: retain failed/truncated experiments too.
  writeFileSync(path, JSON.stringify({ metadata }) + '\n', { flag: 'wx' });
  const results = [],
    started = performance.now();
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(workers, jobs.length) },
      () =>
        new Promise((done, fail) => {
          let worker,
            job,
            timer,
            settling = false;
          const receive = async (record, restart = false) => {
            if (settling) return;
            settling = true;
            clearTimeout(timer);
            results.push(record);
            appendFileSync(path, JSON.stringify(record) + '\n');
            if (results.length % 10 === 0)
              console.error(
                `${results.length}/${jobs.length} games; ${Math.round((performance.now() - started) / 1000)}s`,
              );
            if (restart) await worker.terminate();
            if (next < jobs.length) {
              if (restart) launch();
              send();
            } else {
              if (!restart) await worker.terminate();
              done();
            }
          };
          const launch = () => {
            worker = new Worker(new URL(import.meta.url));
            worker.on('message', (record) => receive(record).catch(fail));
            worker.on('error', (error) =>
              receive(
                {
                  ...job,
                  termination: 'worker_error',
                  winner: null,
                  error: { message: String(error) },
                },
                true,
              ).catch(fail),
            );
          };
          const send = () => {
            job = jobs[next++];
            settling = false;
            timer = setTimeout(
              () =>
                receive(
                  {
                    ...job,
                    termination: 'wall_time_limit',
                    winner: null,
                    elapsedMs: maxEpisodeMs,
                    error: null,
                  },
                  true,
                ).catch(fail),
              maxEpisodeMs,
            );
            worker.postMessage(job);
          };
          launch();
          send();
        }),
    ),
  );
  results.sort((a, b) => a.pair.localeCompare(b.pair) || a.candidateSeat - b.candidateSeat);
  const summary = { metadata, ...summarizePaired(results), elapsedMs: performance.now() - started };
  writeFileSync(path + '.summary.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
