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
