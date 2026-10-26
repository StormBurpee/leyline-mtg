import { runEpisode } from '../packages/simulation/run.js';
const count = Number(process.argv[2] ?? 10),
  firstSeed = Number(process.argv[3] ?? 731);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  count > 10000 ||
  !Number.isSafeInteger(firstSeed) ||
  firstSeed < 0 ||
  firstSeed + count - 1 > 0xffffffff
)
  throw new Error('Usage: node scripts/simulate.mjs [games 1..10000] [first unsigned seed]');
for (let i = 0; i < count; i++) {
  const seed = firstSeed + i,
    startingPlayer = i % 2;
  const result = await runEpisode({ config: { seed, startingPlayer } });
  process.stdout.write(JSON.stringify({ seed, startingPlayer, ...result }) + '\n');
}
