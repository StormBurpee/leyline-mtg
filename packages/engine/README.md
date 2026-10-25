# @leyline/engine

The rules engine used by [Leyline](https://github.com/StormBurpee/leyline-mtg).

ES modules for Node.js 22+ and modern browsers. No runtime dependencies. JavaScript source with TypeScript declarations. This package is a local workspace package; no npm publication is claimed.

```js
import { createGame, dispatch, legalActions } from '@leyline/engine';

let state = createGame({ seed: 731 });
const result = dispatch(state, {
  type: 'keep',
  player: 0,
  expectedRevision: state.revision,
});
if (result.ok) state = result.state;

console.log(legalActions(state, 1));
```

See the repository's architecture, support and contribution documentation before adding cards. The source license does not relicense Magic card names, text or art.
