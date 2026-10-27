import {
  createGame,
  dispatch,
  legalActions,
  exportReplay,
  replay,
  chooseBotCommand,
  ref,
  CARDS,
  type Command,
  type GameState,
  type PlayerId,
} from '@leyline/engine';
let state: GameState = createGame({ seed: 731, names: ['One', 'Two'] });
const command: Command = { type: 'keep', player: 0, expectedRevision: state.revision };
const result = dispatch(state, command);
if (result.ok) state = result.state;
else console.log(result.error.code);
const restored: GameState = replay(exportReplay(state));
const player: PlayerId = restored.choice?.player ?? restored.priority;
const botCommand = chooseBotCommand(restored, player);
if (botCommand) dispatch(restored, botCommand);
for (const action of legalActions(state, player))
  if (action.type === 'cast') dispatch(state, { ...action, player });
const target = ref(state.objects.c1);
const instant: Command = { type: 'cast', player: 0, card: 'c2', target };
void instant;
void CARDS['Lightning Bolt'];
// @ts-expect-error A third player is outside this kernel's contract.
dispatch(state, { type: 'pass', player: 2 });
// @ts-expect-error A cast command must identify its card.
dispatch(state, { type: 'cast', player: 0 });
// @ts-expect-error Unknown commands must not type-check.
dispatch(state, { type: 'skipOpponent', player: 0 });

import { createSession } from '../../packages/simulation/session.js';
import { runEpisode, type Policy } from '../../packages/simulation/run.js';
const session = createSession({ seed: 4 });
const context = session.context();
if (context) {
  const count: number = context.observation.players[0].libraryCount;
  void count;
  // @ts-expect-error Agent observations never contain the shuffle seed.
  void context.observation.seed;
  // @ts-expect-error Agent observations never contain library order.
  void context.observation.players[0].library;
}
const policy: Policy = ({ player }) => ({ type: 'concede', player });
void runEpisode({ policies: [policy, policy], maxDecisions: 100 });

import { compileCard } from '../../packages/cards/compiler.js';
import { compilePack } from '../../packages/cards/pack.js';
const compiled = compileCard({ schemaVersion: 1 });
if (compiled.ok) {
  const name: string = compiled.definition.name;
  void name;
} else {
  const code: string = compiled.diagnostics[0].code;
  void code;
}
const packResult = compilePack([]);
if (packResult.ok) createGame({ catalog: packResult.definitions });

import { spellProfile, spellOptions, castProblem } from '@leyline/engine';
const modal: Command = { type: 'cast', player: 0, card: 'c2', mode: 1 };
void modal;
void spellProfile(CARDS.Abrade, 1);
void spellOptions(CARDS.Abrade);
void castProblem(state, 0, 'c2', undefined, { mode: 1 });

const variableSpell: Command = { type: 'cast', player: 0, card: 'c2', x: 777 };
void variableSpell;
legalActions(state, player, { x: 777 });
