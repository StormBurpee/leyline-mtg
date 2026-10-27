import {
  createGame,
  saddleProblem,
  saddleCandidates,
  saddlePlan,
  tapPower,
  type Command,
  type CardSpec,
} from '@leyline/engine';
const state = createGame();
const command: Command = { type: 'saddle', player: 0, card: 'c1', cards: ['c2'] };
const problem: string | null = saddleProblem(state, 0, 'c1', ['c2']);
const plan: string[] | null = saddlePlan(state, 0, 'c1');
for (const o of saddleCandidates(state, 0, 'c1')) tapPower(state, o, 'c1', 'saddle');
const card: CardSpec = {
  name: 'Test Mount',
  type: 'creature',
  cost: { G: 1 },
  power: 1,
  toughness: 1,
  saddle: 1,
  crewSaddlePowerBonus: 2,
  triggers: [
    {
      event: { event: 'saddled', object: 'source', firstEachTurn: true },
      triggerCondition: { kind: 'sourceSaddled' },
      effects: [{ op: 'gainLife', amount: 1 }],
    },
  ],
};
void [command, problem, plan, card];
