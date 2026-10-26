/** Size a hand from measured space, not just its card count. A fan must retain
 * a usable exposed strip; otherwise use an honest, fully scrollable card rail.
 */
export function handGeometry(count, width, cardWidth, minVisible = 48) {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    !Number.isFinite(width) ||
    width < 0 ||
    !Number.isFinite(cardWidth) ||
    cardWidth <= 0 ||
    !Number.isFinite(minVisible) ||
    minVisible <= 0
  )
    throw new RangeError('Invalid hand geometry.');
  if (!count) return { mode: 'fan', overlap: 0, span: 0 };
  const maximumOverlap = Math.max(0, cardWidth - minVisible);
  const requiredOverlap = count > 1 ? (count * cardWidth - width) / (count - 1) : 0;
  if (count > 10 || width < cardWidth || requiredOverlap > maximumOverlap)
    return { mode: 'rail', overlap: 0, span: count * cardWidth + (count - 1) * 8 };
  const overlap =
    count > 1
      ? Math.max(0, Math.min(maximumOverlap, Math.max(cardWidth * 0.12, requiredOverlap)))
      : 0;
  return { mode: 'fan', overlap, span: count * cardWidth - (count - 1) * overlap };
}
export function readableHandCard(state, ui, player) {
  return (
    [ui.selected, ui.inspectObject].find((id) => {
      const object = state?.objects[id];
      return (
        object?.zone === 'hand' &&
        object.owner === player &&
        state.players[player].hand.includes(id)
      );
    }) ?? null
  );
}
export function installHandLayout(root) {
  let observed = null;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  function refresh() {
    const hand = root.querySelector('.game-layout .hand');
    if (hand !== observed) {
      observer?.disconnect();
      observed = hand;
      if (hand) observer?.observe(hand);
    }
    if (!hand) return;
    const cards = [...hand.querySelectorAll('.hand-card')];
    if (!cards.length) return;
    // Identical horizontal padding in both modes prevents resize oscillation.
    hand.dataset.layout ??= 'fan';
    const style = getComputedStyle(hand);
    const width = hand.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const cardWidth = cards[0].offsetWidth;
    if (width <= 0 || cardWidth <= 0) return;
    const layout = handGeometry(cards.length, width, cardWidth);
    hand.dataset.layout = layout.mode;
    hand.classList.toggle('wide-hand', layout.mode === 'rail');
    hand.style.setProperty('--hand-overlap', layout.overlap + 'px');
    hand.setAttribute(
      'aria-label',
      layout.mode === 'rail' ? 'Your hand. Scroll sideways for more cards.' : 'Your hand',
    );
  }
  return refresh;
}
