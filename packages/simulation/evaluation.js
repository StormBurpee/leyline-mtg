/** Evaluation sees outcomes; policies never receive scheduling or seed metadata. */
export function summarizePaired(records) {
  const totals = { games: records.length, wins: 0, losses: 0, draws: 0, invalid: 0 };
  const terminations = {},
    decks = {},
    pairs = new Map();
  for (const r of records) {
    terminations[r.termination] = (terminations[r.termination] ?? 0) + 1;
    const d = (decks[r.decks.join('/')] ??= { wins: 0, losses: 0, draws: 0, invalid: 0 });
    const result =
      r.termination !== 'finished'
        ? 'invalid'
        : r.winner === null
          ? 'draws'
          : r.winner === r.candidateSeat
            ? 'wins'
            : 'losses';
    totals[result]++;
    d[result]++;
    if (!pairs.has(r.pair)) pairs.set(r.pair, []);
    pairs.get(r.pair).push({
      seat: r.candidateSeat,
      result,
      block: r.seed === undefined ? r.pair : `${r.decks.join('/')}:${r.seed}`,
    });
  }
  const scores = [];
  const blocks = new Map();
  let excludedPairs = 0,
    swept = 0,
    sweptAgainst = 0;
  for (const pair of pairs.values()) {
    const block = pair[0].block;
    if (!blocks.has(block)) blocks.set(block, []);
    if (
      pair.length !== 2 ||
      new Set(pair.map((r) => r.seat)).size !== 2 ||
      pair.some((r) => r.result === 'invalid')
    ) {
      excludedPairs++;
      blocks.get(block).push(null);
      continue;
    }
    const score =
      pair.reduce((sum, r) => sum + (r.result === 'wins' ? 1 : r.result === 'draws' ? 0.5 : 0), 0) /
      2;
    scores.push(score);
    blocks.get(block).push(score);
    swept += Number(score === 1);
    sweptAgainst += Number(score === 0);
  }
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const se =
    scores.length > 1
      ? Math.sqrt(
          scores.reduce((v, x) => v + (x - mean) ** 2, 0) / (scores.length - 1) / scores.length,
        )
      : null;
  const blockScores = [...blocks.values()]
    .filter((b) => !b.includes(null))
    .map((b) => b.reduce((a, c) => a + c, 0) / b.length);
  const blockMean = blockScores.length
    ? blockScores.reduce((a, b) => a + b, 0) / blockScores.length
    : null;
  const blockSE =
    blockScores.length > 1
      ? Math.sqrt(
          blockScores.reduce((sum, x) => sum + (x - blockMean) ** 2, 0) /
            (blockScores.length - 1) /
            blockScores.length,
        )
      : null;
  return {
    ...totals,
    terminations,
    decks,
    completePairs: scores.length,
    excludedPairs,
    pairedScore: mean,
    pairedNormal95:
      se === null ? null : [Math.max(0, mean - 1.96 * se), Math.min(1, mean + 1.96 * se)],
    // Both starting players reuse a deck shuffle: cluster those pairs together.
    completeBlocks: blockScores.length,
    excludedBlocks: blocks.size - blockScores.length,
    blockScore: blockMean,
    blockNormal95:
      blockSE === null
        ? null
        : [Math.max(0, blockMean - 1.96 * blockSE), Math.min(1, blockMean + 1.96 * blockSE)],
    swept,
    sweptAgainst,
  };
}

/** A stricter summary: all decks, seats and starts sharing a seed form one unit.
 * Exclude an entire seed if any episode/pair is invalid. The t approximation uses
 * a conservatively rounded critical value of 3 for 5–29 seeds, 2.1 thereafter;
 * fewer than five seeds are reported without an interval. This is not a
 * distribution-free confidence bound or evidence about untested deck families.
 */
export function summarizeSeeds(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.seed === undefined) continue;
    if (!groups.has(r.seed)) groups.set(r.seed, []);
    groups.get(r.seed).push(r);
  }
  const seeds = [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([seed, rows]) => {
      const paired = summarizePaired(rows);
      const valid = !paired.invalid && !paired.excludedPairs;
      return { seed, games: rows.length, score: valid ? paired.pairedScore : null };
    });
  const scores = seeds.filter((r) => r.score !== null).map((r) => r.score);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const se =
    scores.length > 1
      ? Math.sqrt(
          scores.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (scores.length - 1) / scores.length,
        )
      : null;
  const critical = scores.length < 5 ? null : scores.length < 30 ? 3 : 2.1;
  return {
    seeds,
    completeSeeds: scores.length,
    excludedSeeds: seeds.length - scores.length,
    score: mean,
    conservative95:
      critical === null
        ? null
        : [Math.max(0, mean - critical * se), Math.min(1, mean + critical * se)],
  };
}
