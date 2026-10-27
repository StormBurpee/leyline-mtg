import { definition, stats } from '../../packages/engine/src/model.js';

export const escapeChoice = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const esc = escapeChoice;
export const CARD_DECISIONS = new Set([
  'mulligan',
  'bottom',
  'discard',
  'discardEffect',
  'sacrifice',
  'removeCounter',
  'behold',
  'castExiled',
  'manaColor',
  'exilePlay',
  'empowerJace',
  'bindingNegotiation',
  'revealDiscard',
  'exileToGraveyard',
  'libraryOrder',
  'librarySearch',
  'legendRule',
  'optionalEffect',
  'effectChoice',
  'payCost',
  'creatureType',
  'landType',
  'landName',
  'auraEntry',
  'entryLife',
  'triggerTargets',
  'triggerMode',
]);
const gameIdentities = new WeakMap();
let nextGameIdentity = 0;
export function decisionLease(state, player) {
  if (state?.choice?.player !== player) return null;
  const config = state.config;
  let game = 'public';
  if (config && typeof config === 'object') {
    if (!gameIdentities.has(config)) gameIdentities.set(config, ++nextGameIdentity);
    game = gameIdentities.get(config);
  }
  return `${game}:${state.revision}:${state.choice.kind}:${player}`;
}
export function decisionCard(
  state,
  id,
  metadata,
  {
    selected = false,
    disabled = false,
    action = 'selectDecisionCard',
    label = '',
    badge = '',
    viewer = 0,
    extra = '',
    draggable = false,
  } = {},
) {
  const object = state.objects[id];
  if (!object) return '';
  const concealed = object.faceDown && object.controller !== viewer;
  const d = definition(state, object),
    name = concealed ? 'Face-down creature' : object.transformed ? d.name : object.name,
    m = concealed ? {} : metadata[name];
  const image = m?.image;
  const details =
    object.zone === 'battlefield' && d.type === 'creature'
      ? `${stats(state, object).power}/${stats(state, object).toughness}${object.tapped ? ' · Tapped' : ' · Untapped'}${object.plusCounters ? ` · ${object.plusCounters} +1/+1 counters` : ''}${object.stunCounters ? ` · ${object.stunCounters} stun counters` : ''}`
      : (m?.type_line ?? d.type);
  const rules = concealed ? 'Colorless 2/2 creature with ward {2}.' : (m?.oracle_text ?? d.text);
  return `<article class="decision-card-tile ${selected ? 'is-selected' : ''} ${disabled ? 'is-ineligible' : ''}" data-search="${esc(name.toLowerCase())}">
 <button class="decision-card-face" data-action="${esc(action)}" data-cardid="${esc(id)}" ${extra} ${draggable ? `draggable="true" data-order-card="${esc(id)}"` : ''} aria-label="${esc(label || `Choose ${name}`)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''}>
 <span class="decision-card-fallback"><strong>${esc(name)}</strong><span>${esc(details)}</span><span class="decision-rules">${esc(rules)}</span>${d.type === 'creature' ? `<b>${m?.power ?? (d.baseStats?.power !== undefined ? '*' : d.power)}/${m?.toughness ?? (d.baseStats?.toughness !== undefined ? '*' : d.toughness)}</b>` : ''}</span>
 ${image ? `<img src="${esc(image)}" alt="${esc(name)}" draggable="false" loading="eager">` : ''}
 <span class="decision-selected-mark" aria-hidden="true">✓</span>${badge ? `<span class="decision-card-badge">${esc(badge)}</span>` : ''}
 </button><div class="decision-card-caption"><strong>${esc(name)}</strong><span>${esc(details)}</span></div>
 <button class="decision-read" data-action="readDecisionCard" data-cardid="${esc(id)}" aria-label="Read ${esc(name)}">Read card <span aria-hidden="true">↗</span></button>
 </article>`;
}
export function decisionGallery(state, ids, metadata, options = {}) {
  return `<div class="decision-card-gallery ${ids.length <= 3 ? 'decision-hero' : 'decision-many'}" style="--choice-count:${Math.max(1, ids.length)}">${ids.map((id, i) => decisionCard(state, id, metadata, { ...options, ...options.forCard?.(id, i) })).join('') || '<div class="decision-empty"><span>◇</span><p>No cards available.</p></div>'}</div>`;
}
export function discardChoiceSubtitle(choice) {
  if (!choice.optional) return 'Select the cards to discard, then confirm your choice.';
  const count = `${choice.count} card${choice.count === 1 ? '' : 's'}`;
  const effects = choice.continuation?.then;
  const draw =
    choice.drawOnDiscard ??
    (choice.continuation?.where === undefined &&
    effects?.length === 1 &&
    effects[0].op === 'draw' &&
    [undefined, 'controller'].includes(effects[0].player)
      ? effects[0].count
      : null);
  return Number.isSafeInteger(draw)
    ? `You may discard ${count} to draw ${draw} card${draw === 1 ? '' : 's'}. Or keep your hand unchanged.`
    : `You may discard ${count} to continue this effect. Or keep your hand unchanged.`;
}

export function choiceHeader(
  title,
  subtitle,
  { eyebrow = 'YOUR DECISION', source = '', closeLabel = 'View battlefield' } = {},
) {
  return `<div class="choice-stage-header"><div class="choice-stage-context"><span class="eyebrow">${esc(eyebrow)}</span>${source ? `<span class="choice-source">${esc(source)}</span>` : ''}</div><h2 id="choice-title">${esc(title)}</h2><p id="choice-description">${esc(subtitle)}</p><button class="choice-view-table" data-action="closeDialog">${esc(closeLabel)} <span aria-hidden="true">↗</span></button></div>`;
}
export function decisionReader(state, id, metadata, viewer) {
  const o = state.objects[id];
  if (!o) return '';
  const concealed = o.faceDown && o.controller !== viewer;
  const d = definition(state, o),
    name = concealed ? 'Face-down creature' : o.transformed ? d.name : o.name,
    m = concealed ? {} : metadata[name];
  return `<div class="decision-reader">${decisionCard(state, id, metadata, { action: 'returnDecision', label: 'Back to cards', viewer })}<div class="decision-reader-copy"><span class="eyebrow">${esc(m?.type_line ?? d.type)}</span><h3>${esc(name)}</h3><p>${esc(concealed ? d.text : (m?.oracle_text ?? d.text))}</p>${d.type === 'creature' ? `<span class="decision-reader-stats">${stats(state, o).power} / ${stats(state, o).toughness}</span>` : ''}</div></div>`;
}
