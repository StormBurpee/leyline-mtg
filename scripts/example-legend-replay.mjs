import { createGame, dispatch, exportReplay, CARDS } from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
const name = 'Isamaru, Hound of Konda';
const deck = [...Array(4).fill(name), ...Array(56).fill('Plains')];
let s;
for (let seed = 1; seed <= 100; seed++) {
  s = createGame({
    seed,
    mulligan: false,
    decks: [deck, deck],
    names: ['Legend rule example', 'Sparring partner'],
    catalog: CARDS,
  });
  if (s.players[0].hand.filter((id) => s.objects[id].name === name).length >= 2) break;
}
const act = (type, extra = {}) => {
  const r = dispatch(s, { type, player: s.choice?.player ?? s.priority, ...extra });
  if (!r.ok) throw Error(r.error.message);
  s = r.state;
};
for (let turn = 0; turn < 300 && s.choice?.kind !== 'legendRule'; turn++) {
  if (s.choice?.kind === 'discard') {
    act('discard', { cards: s.players[s.choice.player].hand.slice(-s.choice.count) });
    continue;
  }
  if (s.priority === 0 && s.active === 0 && s.step === 'main1' && !s.stack.length) {
    const plain = s.players[0].hand.find((id) => s.objects[id].name === 'Plains');
    if (plain && s.players[0].landsPlayed === 0) {
      act('playLand', { card: plain });
      continue;
    }
    const card = s.players[0].hand.find((id) => s.objects[id].name === name);
    const mana = Object.values(s.objects).some(
      (o) => o.zone === 'battlefield' && o.controller === 0 && o.name === 'Plains' && !o.tapped,
    );
    if (card && mana) {
      act('cast', { card });
      continue;
    }
  }
  act('pass');
  if (s.choice?.kind === 'attackers') act('attackers', { cards: [] });
}
if (s.choice?.kind !== 'legendRule') throw Error('Legend choice not reached');
await writeFile(
  new URL('../apps/web/example-legend-replay.json', import.meta.url),
  JSON.stringify(exportReplay(s), null, 2) + '\n',
);
console.log(`Legend example: seed ${s.seed}, ${s.revision} commands`);
