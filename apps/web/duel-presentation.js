import { installHandLayout } from './hand-layout.js';
import {
  definition,
  planPayment,
  legalActions,
  castProblem,
  targetsFor,
} from '../../packages/engine/src/index.js';
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function installDuelPresentation(root, context) {
  const layoutHand = installHandLayout(root);
  const preview = document.createElement('div');
  preview.id = 'card-preview';
  preview.setAttribute('aria-hidden', 'true');
  document.body.append(preview);
  const ns = 'http://www.w3.org/2000/svg',
    aim = document.createElementNS(ns, 'svg'),
    path = document.createElementNS(ns, 'path'),
    dot = document.createElementNS(ns, 'circle');
  aim.classList.add('click-target-tether');
  aim.setAttribute('aria-hidden', 'true');
  dot.setAttribute('r', '7');
  aim.append(path, dot);
  document.body.append(aim);
  const stackAim = document.createElementNS(ns, 'svg'),
    stackPath = document.createElementNS(ns, 'path'),
    stackDot = document.createElementNS(ns, 'circle');
  stackAim.classList.add('stack-target-tether');
  stackAim.setAttribute('aria-hidden', 'true');
  stackDot.setAttribute('r', '6');
  stackAim.append(stackPath, stackDot);
  document.body.append(stackAim);
  let pointer = null,
    previewId = null;
  function hidePreview() {
    preview.classList.remove('visible');
    previewId = null;
  }
  function payment(id) {
    root
      .querySelectorAll('.payment-preview')
      .forEach((el) => el.classList.remove('payment-preview'));
    const { state, ui, player } = context(),
      object = state?.objects[id];
    if (!object || object.zone !== 'hand' || object.owner !== player || state.choice) return;
    const d = definition(state, object);
    if (d.type === 'land') return;
    const plan = planPayment(state, player, d.cost);
    for (const source of plan?.taps ?? [])
      root.querySelector(`[data-card="${CSS.escape(source)}"]`)?.classList.add('payment-preview');
  }
  function show(element) {
    const { state, ui, player, metadata } = context(),
      id = element?.dataset.card,
      o = state?.objects[id];
    if (
      !o ||
      ui.targeting ||
      state.choice?.kind === 'triggerTarget' ||
      document.body.classList.contains('card-dragging')
    )
      return hidePreview();
    const d = definition(state, o),
      m = metadata[o.name],
      r = element.getBoundingClientRect();
    let hint = '';
    if (o.zone === 'hand' && o.owner === player) {
      const playable = legalActions(state, player).some(
        (a) => a.card === id && ['playLand', 'cast'].includes(a.type),
      );
      hint = playable
        ? d.target
          ? 'Click to choose a target · drag to play'
          : d.type === 'land'
            ? 'Double-click or drag to play'
            : 'Double-click or drag to cast'
        : state.priority !== player
          ? 'Waiting for your priority'
          : d.type === 'land'
            ? 'You cannot play this land now'
            : (castProblem(
                state,
                player,
                id,
                d.target ? targetsFor(state, d.target, player)[0] : null,
              ) ?? 'Not playable now');
      payment(id);
    }
    preview.innerHTML = `${m?.image ? `<img src="${escape(m.image)}" alt="">` : `<div class="preview-fallback"><h3>${escape(o.name)}</h3><p>${escape(d.text)}</p></div>`}<div class="preview-caption">${escape(hint || o.name)}</div>`;
    const width = Math.min(270, window.innerWidth - 32),
      height = Math.min(422, window.innerHeight - 94);
    let x = r.right + 14;
    if (x + width > window.innerWidth - 16) x = r.left - width - 14;
    if (x < 16) x = Math.max(16, Math.min(window.innerWidth - width - 16, r.left));
    const y = Math.max(68, Math.min(window.innerHeight - height - 12, r.top - height + 100));
    Object.assign(preview.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      maxHeight: `${height}px`,
    });
    preview.classList.add('visible');
    previewId = id;
  }
  function redrawAim() {
    const { state, ui } = context();
    const active =
      !!state &&
      (ui.targeting || state.choice?.kind === 'triggerTarget') &&
      !document.body.classList.contains('card-dragging');
    aim.classList.toggle('visible', active && !!pointer);
    if (!active || !pointer) return;
    const source =
      root.querySelector('[data-pending-card]') ?? root.querySelector('.target-message');
    if (!source) return;
    const r = source.getBoundingClientRect(),
      x = r.left + r.width / 2,
      y = r.top + Math.min(35, r.height / 2),
      end = pointer;
    path.setAttribute('d', `M${x},${y} Q${x},${Math.min(y, end.y) - 90} ${end.x},${end.y}`);
    dot.setAttribute('cx', end.x);
    dot.setAttribute('cy', end.y);
  }
  function redrawStack() {
    const { state, ui, player } = context();
    const entry = state?.stack.at(-1);
    const shown =
      ui.view === 'play' &&
      !ui.targeting &&
      state?.choice?.kind !== 'triggerTarget' &&
      entry?.target;
    stackAim.classList.toggle('visible', !!shown);
    if (!shown) return;
    const source = root.querySelector(`[data-stack="${CSS.escape(entry.id)}"]`),
      t = entry.target;
    const target =
      t.kind === 'player'
        ? root.querySelector(`.life[data-player="${t.id}"]`)
        : t.kind === 'stack'
          ? root.querySelector(`[data-stack="${CSS.escape(t.id)}"]`)
          : root.querySelector(`[data-card="${CSS.escape(t.id)}"]`);
    if (!source || !target) {
      stackAim.classList.remove('visible');
      return;
    }
    const a = source.getBoundingClientRect(),
      b = target.getBoundingClientRect(),
      x = a.left,
      y = a.top + a.height / 2,
      tx = b.left + b.width / 2,
      ty = b.top + b.height / 2;
    stackPath.setAttribute('d', `M${x},${y} Q${(x + tx) / 2},${Math.min(y, ty) - 65} ${tx},${ty}`);
    stackDot.setAttribute('cx', tx);
    stackDot.setAttribute('cy', ty);
    stackAim.classList.toggle('opposing', entry.controller !== player);
  }
  root.addEventListener('scroll', () => {
    hidePreview();
    redrawStack();
  }, true);
  root.addEventListener('pointerover', (e) => {
    const card = e.target.closest('[data-card]');
    if (card && !card.contains(e.relatedTarget)) show(card);
  });
  root.addEventListener('pointerout', (e) => {
    const card = e.target.closest('[data-card]');
    if (card && !card.contains(e.relatedTarget)) {
      hidePreview();
      const { ui } = context();
      payment(ui.selected);
    }
  });
  root.addEventListener('focusin', (e) => {
    const card = e.target.closest('[data-card]');
    if (card) show(card);
  });
  root.addEventListener('focusout', () => hidePreview());
  root.addEventListener('pointerdown', () => hidePreview());
  document.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    redrawAim();
    redrawStack();
  });
  window.addEventListener('blur', hidePreview);
  window.addEventListener('resize', () => {
    layoutHand();
    hidePreview();
    redrawAim();
    redrawStack();
  });
  return {
    layoutHand,
    hidePreview,
    payment,
    refresh() {
      layoutHand();
      const { state, ui } = context();
      root.classList.toggle(
        'is-targeting',
        !!state && (ui.targeting || state.choice?.kind === 'triggerTarget'),
      );
      hidePreview();
      payment(ui.selected);
      redrawAim();
      redrawStack();
    },
  };
}
