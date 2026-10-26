import { prefersReducedMotion } from './motion.js';
/** Pointer gestures own presentation only. The caller supplies legal commands. */
export function installCardDrag(root, { begin, commit, end, feedback }) {
  let gesture = null;
  let suppressClickUntil = 0;
  const reduced = prefersReducedMotion;
  const clean = () => {
    root
      .querySelectorAll('.drop-ready, .drop-over, .drag-source')
      .forEach((el) => el.classList.remove('drop-ready', 'drop-over', 'drag-source'));
    document.body.classList.remove('card-dragging');
  };
  function finish(accepted = false) {
    const g = gesture;
    if (!g) return;
    gesture = null;
    if (g.scrollFrame) cancelAnimationFrame(g.scrollFrame);
    clean();
    if (root.hasPointerCapture(g.pointerId)) root.releasePointerCapture(g.pointerId);
    if (g.lifted) {
      suppressClickUntil = performance.now() + 350;
      const destination = accepted
        ? (root.querySelector(`[data-pending-card="${CSS.escape(g.id)}"]`) ??
          root.querySelector(`[data-motion-card="${CSS.escape(g.id)}"]`))
        : root.querySelector(`[data-card="${CSS.escape(g.id)}"]`);
      const rect = destination?.getBoundingClientRect() ?? g.rect;
      const current = g.ghost.getBoundingClientRect();
      const animation = g.ghost.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(${rect.left - current.left}px, ${rect.top - current.top}px) scale(${rect.width / current.width}, ${rect.height / current.height})`,
            opacity: accepted ? 0 : 0.25,
          },
        ],
        { duration: reduced() ? 0 : accepted ? 230 : 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
      animation.finished.catch(() => {}).finally(() => g.ghost.remove());
      g.hint.remove();
      g.aim?.remove();
      g.tray?.remove();
    }
    end();
  }
  function locate(g, x, y) {
    const hit = document.elementFromPoint(x, y);
    return g.zones.find(
      (z) => z.element.isConnected && (z.element === hit || z.element.contains(hit)),
    );
  }
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || gesture) return;
    const source = event.target.closest('.hand-card[data-card], .permanent[data-card]');
    if (!source) return;
    const plan = begin(source.dataset.card);
    if (!plan) return;
    gesture = {
      ...plan,
      id: source.dataset.card,
      source,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect: source.getBoundingClientRect(),
      lifted: false,
      touch: event.pointerType === 'touch',
    };
  });
  document.addEventListener('pointermove', (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    g.lastY = event.clientY;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y;
    if (!g.lifted) {
      if (Math.hypot(dx, dy) < 8) return;
      // Horizontal touch movement belongs to the scrollable hand, not the card.
      if (g.touch && Math.abs(dx) > Math.abs(dy)) {
        finish();
        return;
      }
      g.lifted = true;
      const scrollEdge = () => {
        if (gesture !== g) return;
        const y = g.lastY;
        const speed =
          y < 70
            ? -Math.min(12, (70 - y) / 4)
            : y > window.innerHeight - 70
              ? Math.min(12, (y - window.innerHeight + 70) / 4)
              : 0;
        if (speed) window.scrollBy(0, speed);
        g.scrollFrame = requestAnimationFrame(scrollEdge);
      };
      g.scrollFrame = requestAnimationFrame(scrollEdge);
      root.setPointerCapture(event.pointerId);
      g.ghost = g.source.cloneNode(true);
      g.ghost.removeAttribute('data-card');
      g.ghost.removeAttribute('data-motion-card');
      g.ghost.removeAttribute('id');
      g.ghost.setAttribute('aria-hidden', 'true');
      g.ghost.tabIndex = -1;
      g.ghost.className = 'card-flight drag-ghost';
      Object.assign(g.ghost.style, { width: `${g.rect.width}px`, height: `${g.rect.height}px` });
      document.body.append(g.ghost);
      g.hint = document.createElement('div');
      g.hint.className = 'drag-instruction';
      g.hint.textContent = g.label;
      document.body.append(g.hint);
      if (g.targeted) {
        const ns = 'http://www.w3.org/2000/svg';
        g.aim = document.createElementNS(ns, 'svg');
        g.aim.classList.add('target-tether');
        g.aim.setAttribute('aria-hidden', 'true');
        g.path = document.createElementNS(ns, 'path');
        g.dot = document.createElementNS(ns, 'circle');
        g.dot.setAttribute('r', '7');
        g.aim.append(g.path, g.dot);
        document.body.append(g.aim);
      }
      const stackTargets = g.zones.filter((zone) => zone.stackLabel || zone.trayLabel);
      if (stackTargets.length) {
        g.tray = document.createElement('div');
        g.tray.className = 'drag-stack-tray';
        const heading = document.createElement('span');
        heading.className = 'eyebrow';
        heading.textContent = 'Drop onto a target';
        g.tray.append(heading);
        for (const zone of stackTargets) {
          const element = document.createElement('div');
          element.className = 'drag-stack-target';
          element.textContent = zone.trayLabel ?? zone.stackLabel;
          g.tray.append(element);
          g.zones.push({ ...zone, element });
        }
        g.zones = g.zones.filter((zone) => !zone.proxyOnly || g.tray.contains(zone.element));
        document.body.append(g.tray);
      }
      g.source.classList.add('drag-source');
      g.zones.forEach((z) => z.element.classList.add('drop-ready'));
      document.body.classList.add('card-dragging');
    }
    event.preventDefault();
    Object.assign(g.ghost.style, {
      left: `${event.clientX - g.rect.width / 2}px`,
      top: `${event.clientY - g.rect.height * 0.55}px`,
    });
    const zone = locate(g, event.clientX, event.clientY);
    g.zones.forEach((z) => z.element.classList.toggle('drop-over', z === zone));
    g.hint.textContent = zone ? zone.label : g.label;
    if (g.aim) {
      const x = g.rect.left + g.rect.width / 2,
        y = g.rect.top + g.rect.height / 2;
      g.path.setAttribute(
        'd',
        `M ${x} ${y} Q ${x} ${event.clientY} ${event.clientX} ${event.clientY}`,
      );
      g.dot.setAttribute('cx', String(event.clientX));
      g.dot.setAttribute('cy', String(event.clientY));
      g.aim.classList.toggle('locked', !!zone);
    }
  });
  document.addEventListener('pointerup', (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    if (!g.lifted) {
      finish();
      return;
    }
    const zone = locate(g, event.clientX, event.clientY);
    if (zone) {
      let accepted = false;
      try {
        accepted = commit(g, zone);
      } finally {
        finish(accepted);
      }
    } else {
      if (!g.zones.length)
        feedback(
          'This card cannot be played right now. Check priority, timing and available mana.',
        );
      finish();
    }
  });
  root.addEventListener('pointercancel', () => finish());
  root.addEventListener('lostpointercapture', () => finish());
  window.addEventListener('blur', () => finish());
  window.addEventListener('resize', () => finish());
  document.addEventListener(
    'keydown',
    (event) => {
      if (gesture && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish();
      }
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (performance.now() < suppressClickUntil && event.detail !== 0 && event.target === root) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  root.addEventListener('dragstart', (event) => {
    if (event.target.closest('[data-card]')) event.preventDefault();
  });
  return {
    get active() {
      return gesture !== null;
    },
    cancel: () => finish(),
  };
}
