/** Keep the match inside the visible browser viewport. Older iOS releases and
 * in-app browsers can retain a large `vh` while their toolbars cover the page.
 * Do not reflow the table while the user pinch-zooms: zoom must remain usable.
 */
export function installTableViewport(root, view = window) {
  let frame = null;
  function update() {
    frame = null;
    const viewport = view.visualViewport;
    if (viewport && Math.abs((viewport.scale ?? 1) - 1) > 0.01) return;
    const height = viewport?.height ?? view.innerHeight;
    if (Number.isFinite(height) && height > 0)
      root.style.setProperty('--table-viewport-height', `${Math.round(height)}px`);
  }
  function schedule() {
    if (frame !== null) return;
    frame = view.requestAnimationFrame(update);
  }
  update();
  view.addEventListener('resize', schedule);
  view.addEventListener('orientationchange', schedule);
  view.addEventListener('pageshow', schedule);
  view.visualViewport?.addEventListener('resize', schedule);
  return () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    view.removeEventListener('resize', schedule);
    view.removeEventListener('orientationchange', schedule);
    view.removeEventListener('pageshow', schedule);
    view.visualViewport?.removeEventListener('resize', schedule);
    root.style.removeProperty('--table-viewport-height');
  };
}
