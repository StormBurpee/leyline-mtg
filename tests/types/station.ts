import {
  createGame,
  stationProblem,
  stationCandidates,
  stationPlan,
  type Command,
  type CardSpec,
  type StackEntry,
} from '@leyline/engine';
const state = createGame();
const command: Command = { type: 'station', player: 0, card: 'c1', cards: ['c2'] };
const problem: string | null = stationProblem(state, 0, 'c1', ['c2']);
const plan: string[] | null = stationPlan(state, 0, 'c1');
const objects = stationCandidates(state, 0, 'c1');
const counters: number | undefined = objects[0]?.chargeCounters;
const card: CardSpec = {
  name: 'Test Spacecraft',
  type: 'artifact',
  cost: { generic: 2 },
  station: true,
  stationLevels: [{ threshold: 4, power: 2, toughness: 2, grants: { keywords: ['flying'] } }],
};
const payer: StackEntry['stationPayer'] = { kind: 'object', id: 'c2', incarnation: 1 };
const effect: StackEntry['effects'][number] = { op: 'stationCharge' };
void [command, problem, plan, counters, card, payer, effect];
