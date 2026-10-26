/** Global duel shortcuts must not steal typing or native button activation. */
export function duelShortcut(event, context) {
  if (
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    context.dialogOpen ||
    !context.hasState ||
    context.view !== 'play'
  )
    return null;
  if (event.editable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.targetTag)) return null;
  if (event.key === 'Escape') return 'cancelSelection';
  if (context.replay) return null;
  if (event.key.toLowerCase() === 'f') return 'toggleFullControl';
  if (event.key === 'Enter' && event.shiftKey) return 'yieldTurn';
  if (
    event.key === 'Enter' &&
    event.focusedCard &&
    event.focusedCard === context.selected &&
    !context.targeting
  )
    return 'playSelected';
  if (event.targetTag === 'BUTTON') return null;
  if (event.key === 'Enter') return context.selected ? 'playSelected' : 'yieldResponse';
  if (event.code === 'Space' && !context.hasChoice && context.hasPriority) return 'pass';
  return null;
}
