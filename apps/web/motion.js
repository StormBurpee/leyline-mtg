export function prefersReducedMotion() {
  return (
    document.documentElement?.dataset.motion === 'reduced' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
/** DOM snapshots keep animation outside deterministic game state and replay data. */
export function captureTable(root, state) {
  const cards = new Map();
  for (const element of root.querySelectorAll('[data-motion-card]')) {
    cards.set(element.dataset.motionCard, {
      rect: element.getBoundingClientRect(),
      clone: element.cloneNode(true),
      zone: element.dataset.motionZone,
      transform: getComputedStyle(element).transform,
    });
  }
  const life = new Map(
    [...root.querySelectorAll('.life[data-player]')].map((el) => [
      el.dataset.player,
      Number(el.textContent),
    ]),
  );
  const origins = new Map(
    Object.values(state?.objects ?? {}).map((object) => [object.id, object.zone]),
  );
  return { cards, life, origins };
}
function animate(element, frames, duration = 360) {
  const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.8,.24,1)' });
  return animation.finished.catch(() => {});
}
export function animateTable(root, before, state, { skip = null } = {}) {
  if (prefersReducedMotion()) return;
  const after = new Map(
    [...root.querySelectorAll('[data-motion-card]')].map((el) => [el.dataset.motionCard, el]),
  );
  for (const [id, element] of after) {
    if (id === skip) continue;
    const previous = before.cards.get(id),
      rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (previous && previous.zone === element.dataset.motionZone) {
      const x = previous.rect.left - rect.left,
        y = previous.rect.top - rect.top;
      const transform = getComputedStyle(element).transform;
      if (Math.abs(x) + Math.abs(y) > 1 || previous.transform !== transform)
        animate(element, [
          {
            transform: `translate(${x}px, ${y}px) ${previous.transform === 'none' ? '' : previous.transform}`,
          },
          { transform },
        ]);
    } else {
      const object = state.objects[id];
      const oldZone = before.origins.get(id);
      const source = root.querySelector(
        oldZone === 'library'
          ? `[data-library="${object?.owner}"]`
          : oldZone === 'hand'
            ? `[data-hand-owner="${object?.owner}"]`
            : ['graveyard', 'exile'].includes(oldZone)
              ? `[data-zone="${oldZone}"][data-player="${object?.owner}"]`
              : oldZone === 'stack'
                ? '.side-content'
                : `[data-field="${object?.controller}"]`,
      );
      const sourceRect = source?.getBoundingClientRect();
      const origin = previous?.rect ?? (oldZone ? sourceRect : rect);
      if (!origin) continue;
      animate(
        element,
        [
          {
            transform: `translate(${origin.left - rect.left}px, ${origin.top - rect.top}px) scale(.65)`,
            opacity: 0,
          },
          { transform: getComputedStyle(element).transform, opacity: 1 },
        ],
        420,
      );
    }
  }
  for (const [id, previous] of before.cards) {
    if (after.has(id) || id === skip) continue;
    const object = state.objects[id];
    if (!object || !['graveyard', 'exile'].includes(object.zone)) continue;
    const destination = root.querySelector(
      `[data-zone="${object.zone}"][data-player="${object.owner}"]`,
    );
    if (!destination) continue;
    const rect = destination.getBoundingClientRect(),
      ghost = previous.clone;
    ghost.removeAttribute('data-motion-card');
    ghost.removeAttribute('data-card');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('card-flight');
    Object.assign(ghost.style, {
      left: `${previous.rect.left}px`,
      top: `${previous.rect.top}px`,
      width: `${previous.rect.width}px`,
      height: `${previous.rect.height}px`,
    });
    document.body.append(ghost);
    animate(
      ghost,
      [
        { opacity: 1, transform: 'none' },
        {
          opacity: 0,
          transform: `translate(${rect.left - previous.rect.left}px, ${rect.top - previous.rect.top}px) scale(.15)`,
        },
      ],
      320,
    ).finally(() => ghost.remove());
  }
  for (const element of root.querySelectorAll('.life[data-player]')) {
    const old = before.life.get(element.dataset.player),
      delta = Number(element.textContent) - old;
    if (!Number.isFinite(delta) || !delta) continue;
    const rect = element.getBoundingClientRect(),
      label = document.createElement('span');
    label.className = `life-change ${delta < 0 ? 'loss' : 'gain'}`;
    label.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
    label.setAttribute('aria-hidden', 'true');
    Object.assign(label.style, { left: `${rect.left}px`, top: `${rect.top}px` });
    document.body.append(label);
    animate(
      label,
      [
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-42px)', opacity: 0 },
      ],
      850,
    ).finally(() => label.remove());
    animate(
      element,
      [
        { color: delta < 0 ? '#ef9d87' : '#c8e9ad', transform: 'scale(1.18)' },
        { color: getComputedStyle(element).color, transform: 'scale(1)' },
      ],
      480,
    );
  }
}

export function renderCombatLinks(root, state, pending = []) {
  root.querySelector('.combat-links')?.remove();
  const arena = root.querySelector('.arena');
  if (!arena || !state) return;
  const pairs =
    state.choice?.kind === 'blockers'
      ? pending
      : Object.entries(state.combat.blocks).flatMap(([attacker, blockers]) =>
          blockers.map((blocker) => ({ attacker, blocker: blocker.id })),
        );
  if (!pairs.length) return;
  const bounds = arena.getBoundingClientRect();
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg');
  svg.classList.add('combat-links');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  for (const pair of pairs) {
    const attacker = root.querySelector(`[data-card="${CSS.escape(pair.attacker)}"]`);
    const blocker = root.querySelector(`[data-card="${CSS.escape(pair.blocker)}"]`);
    if (!attacker || !blocker) continue;
    const a = attacker.getBoundingClientRect(),
      b = blocker.getBoundingClientRect();
    const aField = attacker.closest('.permanents').getBoundingClientRect();
    const bField = blocker.closest('.permanents').getBoundingClientRect();
    if (
      a.left + a.width / 2 < aField.left ||
      a.left + a.width / 2 > aField.right ||
      b.left + b.width / 2 < bField.left ||
      b.left + b.width / 2 > bField.right
    )
      continue;
    const ax = a.left + a.width / 2 - bounds.left,
      bx = b.left + b.width / 2 - bounds.left;
    const ay = (a.top < b.top ? a.bottom : a.top) - bounds.top;
    const by = (a.top < b.top ? b.top : b.bottom) - bounds.top;
    const middle = (ay + by) / 2,
      path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M ${ax} ${ay} C ${ax} ${middle}, ${bx} ${middle}, ${bx} ${by}`);
    if (state.choice?.kind === 'blockers') path.setAttribute('stroke-dasharray', '5 5');
    svg.append(path);
  }
  arena.append(svg);
}

/** Short source-to-target feedback for accepted damage events, never game state. */
export function animateEffects(root, before, state, events) {
  if (prefersReducedMotion()) return;
  for (const event of events.filter((e) => e.type === 'damage' && e.amount > 0).slice(0, 16)) {
    const target =
      event.target.kind === 'player'
        ? root.querySelector(`.life[data-player="${event.target.id}"]`)
        : root.querySelector(`[data-card="${CSS.escape(event.target.id)}"]`);
    const destination = target?.getBoundingClientRect() ?? before.cards.get(event.target.id)?.rect;
    const origin =
      before.cards.get(event.source)?.rect ??
      root.querySelector(`[data-card="${CSS.escape(event.source)}"]`)?.getBoundingClientRect();
    if (!destination) continue;
    target?.animate(
      [
        { filter: 'brightness(2)', boxShadow: '0 0 28px #eea06a' },
        { filter: 'brightness(1)', boxShadow: 'none' },
      ],
      { duration: 380, easing: 'ease-out' },
    );
    if (!origin) continue;
    const ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg'),
      path = document.createElementNS(ns, 'path');
    svg.classList.add('resolution-ray');
    svg.setAttribute('aria-hidden', 'true');
    const x = origin.left + origin.width / 2,
      y = origin.top + origin.height / 2,
      tx = destination.left + destination.width / 2,
      ty = destination.top + destination.height / 2;
    path.setAttribute('d', `M${x},${y} Q${(x + tx) / 2},${Math.min(y, ty) - 50} ${tx},${ty}`);
    svg.append(path);
    document.body.append(svg);
    animate(svg, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], 420).finally(() =>
      svg.remove(),
    );
  }
}
