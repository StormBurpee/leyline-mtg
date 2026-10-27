import { activationSacrificePosition } from './activation-sacrifice-position.js';
import { act } from '../../packages/engine/test/helpers.js';
export function activatedXPosition(ability = {}, cost = {}) {
  let s = activationSacrificePosition(1, {
    ability: { effects: [{ op: 'draw', count: { kind: 'x' } }], ...ability },
    cost: { mana: { X: 1 }, ...cost },
  });
  s = act(s, 'playLand', { card: s.players[0].hand.find((id) => s.objects[id].name === 'Forest') });
  return s;
}
