import { CARDS, createGame, dispatch } from '../../packages/engine/src/index.js';
export function activationSacrificePosition(count = 1, { ability = {}, cost = {} } = {}) {
  const catalog = {
    ...CARDS,
    'Chosen Sacrificer': {
      name: 'Chosen Sacrificer',
      type: 'creature',
      cost: { generic: 0 },
      color: [],
      keywords: [],
      power: 2,
      toughness: 3,
      activated: [
        {
          cost: { sacrifice: { count, where: { type: 'creature' }, excludeSource: true }, ...cost },
          effects: [{ op: 'draw', count: 1 }],
          text: `Sacrifice ${count} other creatures: Draw a card.`,
          ...ability,
        },
      ],
    },
    'Grizzly Bears': { ...CARDS['Grizzly Bears'], cost: {} },
  };
  let s;
  for (let seed = 1; seed < 200; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(4).fill('Chosen Sacrificer'),
          ...Array(4).fill('Grizzly Bears'),
          ...Array(52).fill('Forest'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    const hand = s.players[0].hand.map((id) => s.objects[id].name);
    if (
      hand.includes('Chosen Sacrificer') &&
      hand.filter((n) => n === 'Grizzly Bears').length >= Math.max(2, count)
    )
      break;
  }
  function act(type, extra = {}) {
    const result = dispatch(s, { type, player: s.choice?.player ?? s.priority, ...extra });
    if (!result.ok) throw Error(result.error.message);
    s = result.state;
  }
  while (s.step !== 'main1') act('pass');
  const names = ['Chosen Sacrificer', ...Array(Math.max(2, count)).fill('Grizzly Bears')];
  for (const name of names) {
    const card = s.players[0].hand.find((id) => s.objects[id].name === name);
    if (!card) throw Error('Cannot prepare sacrifice position');
    act('cast', { card });
    act('pass');
    act('pass');
  }
  return s;
}
