import {
  flattenTargets,
  targetGroupCandidates,
  targetPlanProblem,
} from '../../packages/engine/src/target-groups.js';
import { crewProblem, crewCandidates } from '../../packages/engine/src/crew.js';
import { stats } from '../../packages/engine/src/model.js';
import { castProblem, abilityProblem } from '../../packages/engine/src/engine.js';
import {
  CARD_DECISIONS,
  decisionLease,
  decisionCard,
  decisionGallery,
  choiceHeader,
  decisionReader,
} from './choice-stage.js';
import { playableZone, playableCards } from '../../packages/engine/src/model.js';
import { castingChoices } from '../../packages/engine/src/spell-modes.js';
import { inspectableCard, readableCard } from './card-inspection.js';
import { readableHandCard } from './hand-layout.js';
import { duelShortcut } from './duel-shortcuts.js';
import { autoCommand, updateYield, stopKey, hasStop } from './priority-policy.js';
import { installDuelPresentation } from './duel-presentation.js';
import {
  deckRoom,
  deckBuilder,
  selectedDeck,
  deckEntries,
  readDeckLibrary,
  DECK_LIBRARY_KEY,
} from './deck-room.js';
import { cardDropPlan } from './drop-plan.js';
import { installCardDrag } from './gestures.js';
import { captureTable, animateTable, renderCombatLinks, animateEffects } from './motion.js';
import {
  spellProfile,
  castingProfile,
  castingPayment,
  castingSacrificeCandidates,
  convokeCandidates,
  MAX_X,
  CARDS,
  definition,
  DECKS,
  VERSION,
  createGame,
  dispatch,
  legalActions,
  expandDeck,
  parseDeck,
  exportReplay,
  replay,
  chooseBotCommand,
  canAttack,
  canBlock,
  canTapForMana,
  manaOptions,
  ref,
  suggestedDamage,
  targetsFor,
} from '../../packages/engine/src/index.js';
import {
  spellModeBody,
  legendChoiceBody,
  escape,
  header,
  game,
  catalog,
  enginePage,
  inspect,
  artStyle,
  mana,
} from './view.js';
const SAVE_KEY = 'leyline.match.v1';
const app = document.querySelector('#app'),
  dialog = document.querySelector('#dialog');
let metadata = {};
try {
  const r = await fetch('./card-metadata.json');
  if (r.ok) metadata = await r.json();
} catch {}
for (const [name, slug] of [
  ['Soldier Token', 'soldier'],
  ['Elemental Token', 'elemental'],
  ['Goblin Token', 'goblin'],
])
  metadata[name] = {
    art: `./tokens/${slug}.svg`,
    image: `./tokens/${slug}-card.svg`,
    artist: 'Leyline original token graphics',
  };
let state = null,
  botTimer = null,
  toastTimer = null;
function readSave() {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}
const ui = {
  view: 'play',
  catalog: CARDS,
  deck: 'storm-rakdos',
  opponentDeck: 'grove',
  personalDecks: [],
  deckQuery: '',
  deckColor: 'all',
  deckDraft: null,
  recoveredDraft: null,
  builderPanel: 'pool',
  builderScroll: {},
  builderQuery: '',
  builderColor: 'all',
  builderType: 'all',
  mode: 'bot',
  seed: 731,
  autoYield: true,
  controlMode: 'smart',
  yieldMode: null,
  yieldTurn: null,
  stops: {},
  autoOrderTriggers: true,
  autoDamage: true,
  handExpanded: true,
  presentationUntil: 0,
  holdPriority: false,
  reduceMotion: false,
  saved: !!readSave(),
  selected: null,
  targeting: false,
  activation: null,
  spellMode: null,
  x: null,
  chosen: [],
  blocks: [],
  inspect: null,
  inspectObject: null,
  sideTab: 'stack',
  seat: 0,
  paused: false,
  inspectorOpen: false,
  query: '',
  filter: 'all',
  customDeck: null,
  replayRecord: null,
  replayIndex: 0,
};
try {
  ui.personalDecks = readDeckLibrary(localStorage);
  const draft = JSON.parse(localStorage.getItem('leyline.deck-draft.v1') ?? 'null');
  if (
    draft &&
    typeof draft.name === 'string' &&
    draft.cards &&
    typeof draft.cards === 'object' &&
    !Array.isArray(draft.cards) &&
    Object.entries(draft.cards).every(
      ([name, n]) => name.length < 160 && Number.isInteger(n) && n > 0 && n <= 250,
    ) &&
    Object.values(draft.cards).reduce((a, b) => a + b, 0) <= 250
  )
    ui.recoveredDraft = draft;
} catch {}
try {
  ui.reduceMotion = localStorage.getItem('leyline.reduce-motion') === 'true';
} catch {}
document.documentElement.dataset.motion = ui.reduceMotion ? 'reduced' : 'system';
let dragMotionCard = null;
const viewer = () => (ui.mode === 'hotseat' ? ui.seat : 0);
const duelPresentation = installDuelPresentation(app, () => ({
  state,
  ui,
  player: viewer(),
  metadata,
}));
function toast(text) {
  const el = document.querySelector('#toast');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}
function render() {
  const scrollPositions = [...app.querySelectorAll('[data-scroll-key]')].map((element) => ({
    key: element.dataset.scrollKey,
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  const focused = document.activeElement;
  let focusSelector = null;
  if (focused?.id) focusSelector = `#${CSS.escape(focused.id)}`;
  else if (focused?.dataset.card)
    focusSelector = `[data-card="${CSS.escape(focused.dataset.card)}"]`;
  else if (focused?.dataset.action) {
    focusSelector = `[data-action="${CSS.escape(focused.dataset.action)}"]`;
    for (const key of ['view', 'name', 'panel', 'tab', 'player', 'zone', 'command', 'stop'])
      if (focused.dataset[key] !== undefined)
        focusSelector += `[data-${key}="${CSS.escape(focused.dataset[key])}"]`;
  }
  const wasDock = !!focused?.closest('.action-dock');
  app.innerHTML = `<div class="shell">${header(ui)}${ui.view === 'builder' ? deckBuilder(ui, metadata) : ui.view === 'decks' ? deckRoom(ui, metadata) : ui.view === 'cards' ? catalog(ui, metadata) : ui.view === 'engine' ? enginePage(state) : state ? game(state, ui, metadata) : deckRoom(ui, metadata)}</div>`;
  duelPresentation.layoutHand();
  for (const position of scrollPositions) {
    const element = app.querySelector(`[data-scroll-key="${CSS.escape(position.key)}"]`);
    if (element) {
      element.scrollLeft = position.left;
      element.scrollTop = position.top;
    }
  }
  const nextFocus = focusSelector ? app.querySelector(focusSelector) : null;
  if (nextFocus && !nextFocus.disabled) nextFocus.focus({ preventScroll: true });
  else if (wasDock)
    app.querySelector('.action-dock button:not(:disabled)')?.focus({ preventScroll: true });
  renderCombatLinks(app, state, ui.blocks);
  duelPresentation.refresh();
  syncDecisionOverlay();
  schedule();
}
let combatFrame = null;
function updateCombatLinks() {
  if (combatFrame !== null) cancelAnimationFrame(combatFrame);
  combatFrame = requestAnimationFrame(() => {
    combatFrame = null;
    renderCombatLinks(app, state, ui.blocks);
  });
}
app.addEventListener('scroll', updateCombatLinks, true);
window.addEventListener('resize', updateCombatLinks);
function resetSelection() {
  dialog._groupKey = null;
  ui.selected = null;
  ui.targeting = false;
  ui.activation = null;
  ui.spellMode = null;
  ui.x = null;
  ui.chosen = [];
  ui.blocks = [];
}
function save() {
  if (!state || ui.replayRecord) return;
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        replay: exportReplay(state),
        mode: ui.mode,
        deck: ui.deck,
        customDeck: ui.customDeck,
        autoYield: ui.autoYield,
        holdPriority: ui.holdPriority,
        controls: {
          controlMode: ui.controlMode,
          stops: ui.stops,
          autoOrderTriggers: ui.autoOrderTriggers,
          autoDamage: ui.autoDamage,
          handExpanded: ui.handExpanded,
        },
      }),
    );
    ui.saved = true;
  } catch {
    toast('Local storage is full or unavailable. Export a replay to save this match.');
  }
}
function send(command, { autoPass = true, automatic = false } = {}) {
  if (ui.replayRecord) {
    toast('Exit replay inspection before playing.');
    return false;
  }
  const c = {
    player: viewer(),
    expectedRevision: state.revision,
    ...(!automatic && command.type === 'cast' && command.card === ui.selected && ui.x != null
      ? { x: ui.x }
      : {}),
    ...command,
  };
  if (
    !automatic &&
    c.type === 'cast' &&
    c.sacrifice === undefined &&
    definition(state, state.objects[c.card]).sacrificeCost
  ) {
    showCastingSacrifice(c);
    return false;
  }
  if (
    !automatic &&
    c.type === 'cast' &&
    c.convoke === undefined &&
    definition(state, state.objects[c.card]).keywords.includes('convoke')
  ) {
    showConvoke(c);
    return false;
  }
  const result = dispatch(state, c);
  if (!result.ok) {
    toast(result.error.message);
    return false;
  }
  clearTimeout(toastTimer);
  document.querySelector('#toast').classList.remove('visible');
  document.querySelector('#toast').textContent = '';
  const motion = captureTable(app, state);
  const previous = state;
  state = result.state;
  updateYield(previous, state, viewer(), ui);
  if (
    !automatic &&
    c.player === viewer() &&
    ['cast', 'playLand', 'activate', 'tapMana'].includes(c.type)
  )
    ui.yieldMode = null;
  const newStack = state.stack.some((entry) => !previous.stack.some((old) => old.id === entry.id));
  const resolved = state.events
    .slice(previous.events.length)
    .some((event) => ['resolved', 'fizzled', 'countered'].includes(event.type));
  ui.presentationUntil =
    performance.now() +
    (newStack
      ? 900
      : resolved
        ? 650
        : c.type === 'playLand'
          ? 480
          : state.turn !== previous.turn
            ? 450
            : 100);
  resetSelection();
  save();
  save();
  render();
  animateTable(app, motion, state, { skip: dragMotionCard });
  animateEffects(app, motion, state, state.events.slice(previous.events.length));
  return true;
}
function schedule() {
  clearTimeout(botTimer);
  if (
    !state ||
    ui.view !== 'play' ||
    ui.paused ||
    cardDrag.active ||
    ui.replayRecord ||
    dialog.open ||
    state.status === 'finished' ||
    ui.mode !== 'bot'
  )
    return;
  const revision = state.revision,
    actor = state.choice?.player ?? state.priority;
  const delay = Math.max(actor === 1 ? 340 : 100, ui.presentationUntil - performance.now());
  if (actor === 1) {
    botTimer = setTimeout(() => {
      if (
        !state ||
        state.revision !== revision ||
        ui.view !== 'play' ||
        dialog.open ||
        cardDrag.active
      )
        return;
      const command = chooseBotCommand(state, 1);
      if (command) send(command, { automatic: true, autoPass: false });
    }, delay);
    return;
  }
  if (!autoCommand(state, 0, ui)) return;
  botTimer = setTimeout(() => {
    if (
      !state ||
      state.revision !== revision ||
      ui.view !== 'play' ||
      dialog.open ||
      cardDrag.active
    )
      return;
    // Recheck user intent at execution time: a stop added during animation wins.
    const command = autoCommand(state, 0, ui);
    if (command) send(command, { automatic: true, autoPass: false });
  }, delay);
}
function showCrewSelection() {
  const draft = dialog._crewDraft;
  if (!draft || draft.revision !== state.revision) {
    closeDialog();
    return;
  }
  const p = viewer(),
    o = state.objects[draft.card];
  const problem = crewProblem(state, p, draft.card, draft.cards);
  const total = draft.cards.reduce((sum, id) => sum + stats(state, state.objects[id]).power, 0);
  const body = `<div class="decision-card-gallery decision-many">${crewCandidates(
    state,
    p,
    draft.card,
  )
    .map((c) =>
      decisionCard(state, c.id, metadata, {
        viewer: p,
        action: 'toggleCrew',
        selected: draft.cards.includes(c.id),
        label: `Crew with ${c.name} (${stats(state, c).power} power)`,
      }),
    )
    .join('')}</div>`;
  openChoiceDialog(
    `Crew ${definition(state, o).crew} — ${o.name}`,
    'Tap other untapped creatures with enough total power. Summoning-sick creatures can crew. Animation resolves on the stack and lasts until end of turn.',
    body,
    `<span>${total} total power${problem ? ` · ${escape(problem)}` : ''}</span><button class="btn primary" data-action="confirmCrew" ${problem ? 'disabled' : ''}>Tap and crew</button><button class="btn" data-action="closeDialog">Cancel</button>`,
    { source: o.name },
  );
  dialog._activeChoice = null;
  dialog._stageRender = showCrewSelection;
}
function openDialog(title, body, actions = '') {
  dialog.classList.remove('choice-stage');
  dialog.removeAttribute('aria-labelledby');
  dialog.removeAttribute('aria-describedby');
  dialog._activeChoice = null;
  dialog._stageRender = null;
  clearTimeout(botTimer);
  duelPresentation.hidePreview();
  dialog.innerHTML = `<div class="dialog-head"><h2>${escape(title)}</h2><button class="icon-btn" data-action="closeDialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${body}</div><div class="dialog-actions">${actions || '<button class="btn" data-action="closeDialog">Done</button>'}</div>`;
  if (!dialog.open) dialog.showModal();
}

function openChoiceDialog(title, subtitle, body, actions, options = {}) {
  clearTimeout(botTimer);
  duelPresentation.hidePreview();
  const focused = document.activeElement;
  const focusCard = focused?.dataset.cardid;
  const focusAction = focused?.dataset.action;
  const focusedFilter = focused?.matches?.('[data-choice-filter]');
  const selectionStart = focusedFilter ? focused.selectionStart : null;
  const wasOpen = dialog.open;
  dialog.classList.add('choice-stage');
  dialog.setAttribute('aria-labelledby', 'choice-title');
  dialog.setAttribute('aria-describedby', 'choice-description');
  dialog.innerHTML = `${choiceHeader(title, subtitle, options)}<div class="dialog-body">${body}</div><div class="dialog-actions">${actions}</div>`;
  if (!wasOpen) dialog.showModal();
  const restore =
    focusCard && focusAction
      ? dialog.querySelector(
          `[data-action="${CSS.escape(focusAction)}"][data-cardid="${CSS.escape(focusCard)}"]`,
        )
      : null;
  const filter = dialog.querySelector('[data-choice-filter]');
  if (filter) {
    filter.value = dialog._choiceQuery ?? '';
    for (const tile of dialog.querySelectorAll('[data-search]'))
      tile.hidden = !tile.dataset.search.includes(filter.value.toLowerCase().trim());
  }
  if (focusedFilter && filter) {
    filter.focus({ preventScroll: true });
    filter.setSelectionRange(selectionStart, selectionStart);
  } else if (restore && !restore.disabled) restore.focus({ preventScroll: true });
  else
    (
      dialog.querySelector('.is-selected .decision-card-face:not(:disabled)') ??
      dialog.querySelector('.decision-card-face:not(:disabled)') ??
      dialog.querySelector('.dialog-actions .primary:not(:disabled)')
    )?.focus({ preventScroll: true });
}
function syncDecisionOverlay() {
  const c = state?.choice;
  if (
    !state ||
    ui.view !== 'play' ||
    ui.replayRecord ||
    c?.player !== viewer() ||
    !(
      CARD_DECISIONS.has(c?.kind) ||
      (c?.kind === 'triggerTarget' &&
        c.targets.some((t) => state.objects[t.id]?.zone === 'graveyard'))
    )
  ) {
    if (dialog.open && dialog._activeChoice) {
      dialog._activeChoice = null;
      dialog.close();
    }
    return;
  }
  const lease = decisionLease(state, viewer());
  if (ui.dismissedChoiceLease === lease || (dialog.open && dialog._activeChoice === c)) return;
  if (dialog.open && !dialog._activeChoice) return;
  presentStateChoice();
}
function presentStateChoice() {
  const c = state?.choice;
  if (
    !c ||
    c.player !== viewer() ||
    !(
      CARD_DECISIONS.has(c.kind) ||
      (c.kind === 'triggerTarget' &&
        c.targets.some((t) => state.objects[t.id]?.zone === 'graveyard'))
    )
  )
    return;
  const lease = decisionLease(state, viewer());
  if (dialog._choiceLease !== lease) {
    dialog._selectedCards = [];
    dialog._choiceLease = lease;
    dialog._choiceQuery = '';
    dialog._creatureType = 'Lizard';
  }
  dialog._choiceRevision = state.revision;
  dialog._activeChoice = c;
  ui.dismissedChoiceLease = null;
  if (c.kind === 'triggerTargets') {
    showGroupedTargets();
    return;
  }
  if (c.kind === 'triggerTarget') {
    showTargetMenu();
    return;
  }
  if (c.kind === 'libraryOrder') {
    showLibraryOrder();
    return;
  }
  if (c.kind === 'librarySearch') {
    showLibrarySearch();
    return;
  }
  const source = state.resolving?.entry.name ?? c.entry?.name ?? c.name ?? '';
  const multi = ['bottom', 'discard', 'discardEffect', 'sacrifice'].includes(c.kind);
  const selected = multi ? ui.chosen : dialog._selectedCards;
  let title = '',
    subtitle = '',
    cards = [],
    actions = '',
    body = '';
  if (c.kind === 'mulligan') {
    title = state.startingPlayer === viewer() ? 'You play first' : 'You draw first';
    subtitle =
      c.player === state.startingPlayer
        ? 'Your opening hand. Keep seven, or take a London mulligan.'
        : 'Choose your opening hand. Your opponent plays first.';
    cards = state.players[viewer()].hand;
    actions = `<span class="choice-selection-summary">${c.player === state.startingPlayer ? 'On the play' : 'On the draw'}<strong>${state.players[viewer()].mulligans ? `${state.players[viewer()].mulligans} card(s) to put back after keeping` : 'Seven cards. Your decision.'}</strong></span><button class="btn" data-action="mulligan" ${state.players[viewer()].mulligans >= 7 ? 'disabled' : ''}>Mulligan</button><button class="btn primary" data-action="keep">Keep ${cards.length}</button>`;
  } else if (multi) {
    title =
      c.kind === 'bottom'
        ? `Put ${c.count} card${c.count === 1 ? '' : 's'} back`
        : c.kind === 'sacrifice'
          ? `Sacrifice ${c.count} permanent${c.count === 1 ? '' : 's'}`
          : `Discard ${c.count} card${c.count === 1 ? '' : 's'}`;
    subtitle =
      c.kind === 'bottom'
        ? 'Choose cards for the bottom of your library. Nothing moves until you confirm.'
        : c.kind === 'sacrifice'
          ? 'Choose permanents you control to sacrifice. This does not target or destroy them.'
          : 'Select the cards to discard, then confirm your choice.';
    cards = c.kind === 'sacrifice' ? c.cards : state.players[viewer()].hand;
    actions = `<span class="choice-selection-summary">${selected.length} of ${c.count} selected</span><button class="btn primary" data-action="confirmDecision" ${selected.length === c.count ? '' : 'disabled'}>${c.kind === 'bottom' ? 'Put selected cards back' : c.kind === 'sacrifice' ? 'Sacrifice selected permanents' : 'Discard selected cards'}</button>`;
  } else if (
    ['exilePlay', 'bindingNegotiation', 'exileToGraveyard', 'legendRule'].includes(c.kind)
  ) {
    title =
      c.kind === 'exilePlay'
        ? 'Choose one'
        : c.kind === 'bindingNegotiation'
          ? 'Choose a card to discard'
          : c.kind === 'exileToGraveyard'
            ? 'Choose an exiled card'
            : 'Choose a legend to keep';
    subtitle =
      c.kind === 'exilePlay'
        ? 'You may play the chosen card until the end of this turn. Normal timing and mana costs still apply.'
        : c.kind === 'bindingNegotiation'
          ? 'Their hand is revealed. Choose a nonland card, or choose none to consider their exile.'
          : c.kind === 'exileToGraveyard'
            ? 'You may put a face-up card the opponent owns from exile into their graveyard.'
            : 'Keep one copy on the battlefield. The other copies go to their owners’ graveyards.';
    cards = c.cards;
    const optional = ['bindingNegotiation', 'exileToGraveyard'].includes(c.kind);
    actions = `<span class="choice-selection-summary">${selected.length} of 1 selected<strong>${selected[0] ? escape(state.objects[selected[0]].name) : 'Select a card above'}</strong></span>${optional ? '<button class="btn" data-action="declineDecision">Choose none</button>' : ''}<button class="btn primary" data-action="confirmDecision" ${selected.length === 1 ? '' : 'disabled'}>${c.kind === 'legendRule' ? 'Keep selected copy' : 'Confirm choice'}</button>`;
  } else if (c.kind === 'optionalEffect' || c.kind === 'payCost') {
    const sourceId = state.resolving?.entry.source?.id;
    cards = sourceId && state.objects[sourceId] ? [sourceId] : [];
    title = c.kind === 'payCost' ? 'Pay for ward?' : 'Resolve this ability?';
    subtitle =
      c.kind === 'payCost'
        ? `Pay ${[...Object.entries(c.cost.mana ?? {}).map(([k, n]) => (k === 'generic' ? `${n} mana` : `${n}${k}`)), ...(c.cost.life ? [`${c.cost.life} life`] : [])].join(' + ')} or the affected spell or ability will be countered.`
        : 'This effect is optional. Review the card before choosing.';
    actions =
      c.kind === 'payCost'
        ? `<button class="btn" data-action="declineWard">Don't pay</button><button class="btn primary" data-action="payWard" ${c.payable ? '' : 'disabled'}>Pay ward</button>`
        : '<button class="btn" data-action="declineOptional">Decline</button><button class="btn primary" data-action="acceptOptional">Resolve effect</button>';
  } else if (c.kind === 'auraEntry') {
    title = `Choose what ${state.objects[c.card].name} enchants`;
    subtitle =
      'This Aura is entering without being cast. Choose a legal permanent; this does not target it.';
    cards = c.cards;
    actions = `<button class="btn primary" data-action="confirmDecision" ${selected.length !== 1 ? 'disabled' : ''}>Attach Aura</button>`;
  } else if (c.kind === 'creatureType') {
    title = 'Choose a creature type';
    subtitle =
      'Cavern of Souls can protect spells of this type when its colored mana pays for them.';
    cards = [c.card];
    actions =
      '<button class="btn primary" data-action="chooseCreatureType">Confirm creature type</button>';
  }
  body = decisionGallery(state, cards, metadata, {
    viewer: viewer(),
    action:
      c.kind === 'mulligan' || ['optionalEffect', 'payCost', 'creatureType'].includes(c.kind)
        ? 'readDecisionCard'
        : 'selectDecisionCard',
    forCard: (id) => ({
      selected: selected.includes(id),
      disabled:
        c.kind === 'bindingNegotiation' && definition(state, state.objects[id]).type === 'land',
      badge:
        c.kind === 'legendRule'
          ? `Copy ${cards.indexOf(id) + 1}`
          : multi && selected.includes(id)
            ? `Selected ${selected.indexOf(id) + 1}`
            : '',
    }),
  });
  if (c.kind === 'creatureType')
    body = `<div class="choice-type-layout">${body}<select class="choice-type-select" id="entry-creature-type" aria-label="Creature type">${c.types.map((type) => `<option value="${escape(type)}" ${type === dialog._creatureType ? 'selected' : ''}>${escape(type)}</option>`).join('')}</select></div>`;
  openChoiceDialog(title, subtitle, body, actions, {
    source,
    eyebrow: c.kind === 'mulligan' ? 'OPENING HAND' : 'YOUR DECISION',
  });
  dialog._activeChoice = c;
  dialog._stageRender = presentStateChoice;
}
function selectDecisionCard(id) {
  const c = state?.choice;
  if (dialog._choiceLease !== decisionLease(state, viewer()) || c?.player !== viewer()) return;
  const multi = ['bottom', 'discard', 'discardEffect', 'sacrifice'].includes(c.kind);
  const allowed = multi && c.kind !== 'sacrifice' ? state.players[viewer()].hand : c.cards;
  if (
    !allowed?.includes(id) ||
    (c.kind === 'bindingNegotiation' && definition(state, state.objects[id]).type === 'land')
  )
    return;
  if (multi) {
    if (ui.chosen.includes(id)) ui.chosen = ui.chosen.filter((x) => x !== id);
    else if (ui.chosen.length < c.count) ui.chosen.push(id);
    else {
      toast(`Choose exactly ${c.count} cards. Deselect one first.`);
      return;
    }
  } else dialog._selectedCards = dialog._selectedCards.includes(id) ? [] : [id];
  presentStateChoice();
}
function confirmDecision(decline = false) {
  const c = state?.choice;
  if (dialog._choiceLease !== decisionLease(state, viewer()) || c?.player !== viewer()) return;
  let command;
  if (['bottom', 'discard', 'discardEffect', 'sacrifice'].includes(c.kind))
    command = { type: c.kind, cards: [...ui.chosen] };
  else if (c.kind === 'auraEntry')
    command = { type: 'chooseAuraAttachment', card: dialog._selectedCards[0] };
  else if (c.kind === 'legendRule')
    command = { type: 'chooseLegend', card: dialog._selectedCards[0] };
  else command = { type: 'chooseResolutionCard', card: decline ? null : dialog._selectedCards[0] };
  command.expectedRevision = dialog._choiceRevision;
  closeDialog();
  send(command);
}

function showCardReader(id) {
  const object = inspectableCard(state, id, viewer());
  if (!object) return false;
  ui.inspect = object.name;
  ui.inspectObject = id;
  openChoiceDialog(
    'A closer look',
    'Card details and current characteristics.',
    decisionReader(state, id, metadata, viewer()).replace(
      'data-action="returnDecision"',
      'data-action="closeDialog"',
    ),
    '<button class="btn primary" data-action="closeDialog">Back to battlefield</button>',
    { eyebrow: 'CARD DETAILS' },
  );
  dialog._activeChoice = null;
  dialog._stageRender = null;
  return true;
}
function closeDialog() {
  dialog._crewDraft = null;
  dialog._convokeDraft = null;
  dialog._castingSacrificeDraft = null;
  if (dialog._activeChoice && state) ui.dismissedChoiceLease = decisionLease(state, viewer());
  dialog.close();
  schedule();
}
dialog.addEventListener('cancel', (event) => {
  if (dialog.classList.contains('choice-stage')) {
    event.preventDefault();
    closeDialog();
  }
});
dialog.addEventListener('close', () => {
  duelPresentation.hidePreview();
  schedule();
});
dialog.addEventListener('input', (event) => {
  if (!event.target.matches('[data-choice-filter]')) return;
  dialog._choiceQuery = event.target.value;
  const query = event.target.value.toLowerCase().trim();
  for (const tile of dialog.querySelectorAll('[data-search]'))
    tile.hidden = !tile.dataset.search.includes(query);
});
dialog.addEventListener('change', (event) => {
  if (event.target.id === 'entry-creature-type') dialog._creatureType = event.target.value;
});
dialog.addEventListener(
  'error',
  (event) => {
    if (event.target.tagName === 'IMG') event.target.hidden = true;
  },
  true,
);
dialog.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-order-card]');
  if (!card) return;
  event.dataTransfer.setData('text/leyline-choice', card.dataset.orderCard);
  event.dataTransfer.effectAllowed = 'move';
});
dialog.addEventListener('dragover', (event) => {
  const lane = event.target.closest('[data-order-drop]');
  if (!lane || !event.dataTransfer.types.includes('text/leyline-choice')) return;
  event.preventDefault();
  lane.classList.add('drag-over');
});
dialog.addEventListener('dragleave', (event) =>
  event.target.closest('[data-order-drop]')?.classList.remove('drag-over'),
);
dialog.addEventListener('drop', (event) => {
  const lane = event.target.closest('[data-order-drop]');
  if (!lane) return;
  event.preventDefault();
  const id = event.dataTransfer.getData('text/leyline-choice');
  if (
    state?.choice?.kind !== 'libraryOrder' ||
    dialog._libraryChoice !== state.choice ||
    !state.choice.cards.includes(id)
  )
    return;
  action('libraryMove', { dataset: { cardid: id, group: lane.dataset.orderDrop } });
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      closeDialog();
  }
});
function start() {
  if ((state && state.status !== 'finished' && !ui.replayRecord) || (!state && ui.saved)) {
    save();
    openDialog(
      'Start a new match?',
      '<p>Your current match will be replaced. Export its replay first if you want to keep it.</p>',
      '<button class="btn" data-action="export">Export current replay</button><button class="btn" data-action="closeDialog">Cancel</button><button class="btn primary" data-action="confirmStart">Start new match</button>',
    );
    return;
  }
  startConfirmed();
}
function startConfirmed() {
  clearTimeout(botTimer);
  ui.replayRecord = null;
  ui.seat = 0;
  ui.paused = false;
  ui.yieldMode = null;
  ui.stops = {};
  resetSelection();
  try {
    state = createGame({
      decks: [
        expandDeck(selectedDeck(ui).cards),
        expandDeck(
          (deckEntries(ui).find(([id]) => id === ui.opponentDeck)?.[1] ?? DECKS.grove).cards,
        ),
      ],
      seed: ui.seed,
      catalog: CARDS,
      names:
        ui.mode === 'hotseat'
          ? ['Player one', 'Player two']
          : [
              selectedDeck(ui).name,
              (deckEntries(ui).find(([id]) => id === ui.opponentDeck)?.[1] ?? DECKS.grove).name,
            ],
    });
    ui.view = 'play';
    save();
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    toast(e.message);
  }
}
function exportMatch() {
  let record;
  try {
    record = state ? exportReplay(state) : JSON.parse(readSave() ?? 'null')?.replay;
  } catch {
    toast('The saved match could not be read.');
    return;
  }
  if (!record) {
    toast('There is no match to export.');
    return;
  }
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `leyline-match-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Replay exported. It contains both players’ full decks and hidden cards.');
}
function showDeck() {
  const list = selectedDeck(ui).cards;
  openDialog(
    selectedDeck(ui).name,
    `<p style="margin-bottom:16px">${Object.values(list).reduce((a, b) => a + b, 0)} cards · supported local constructed pool</p>${Object.entries(
      list,
    )
      .map(
        ([n, c]) =>
          `<div class="rule-row"><span>${c} × ${escape(n)}</span>${mana((ui.catalog[n] ?? CARDS[n])?.cost ?? {})}</div>`,
      )
      .join('')}`,
  );
}
function showXChoice() {
  const o = state?.objects[ui.selected];
  if (!o) return;
  const values = [
    ...new Set(
      legalActions(state, viewer())
        .filter((a) => a.type === 'cast' && a.card === o.id && a.x !== undefined)
        .map((a) => a.x),
    ),
  ];
  ui.x = null;
  ui.targeting = false;
  openChoiceDialog(
    'Choose X',
    `${o.name} · Choose X before targets; targets can change the final cost. Implementation range: 0–${MAX_X}.`,
    `<label>Other X value <input id="cast-x-value" type="number" min="0" max="${MAX_X}" step="1" value="0"></label><button class="btn primary" data-action="chooseX">Use this X</button><div class="decision-mode-grid">${values.map((x) => `<button class="decision-mode" data-action="chooseX" data-x="${x}"><strong>X = ${x}</strong><span>${mana(castingProfile(state, viewer(), o, undefined, null, undefined, x).cost)}</span></button>`).join('')}</div>`,
    '<button class="btn quiet" data-action="closeDialog">Cancel casting</button>',
    { eyebrow: 'VARIABLE COST' },
  );
  dialog._xCard = ref(o);
  dialog._xRevision = state.revision;
  dialog._activeChoice = null;
  dialog._stageRender = showXChoice;
}
function showSpellModes() {
  const o = state?.objects[ui.selected];
  if (!o || !playableZone(state, o, viewer()) || !castingChoices(definition(state, o))) return;
  ui.spellMode = null;
  ui.x = null;
  ui.targeting = false;
  render();
  const choices = castingChoices(definition(state, o)),
    legal = legalActions(state, viewer());
  const body = `<div class="decision-mode-grid">${choices.map((mode, index) => `<button class="decision-mode" data-action="chooseSpellMode" data-mode="${index}" ${legal.some((a) => a.type === 'cast' && a.card === o.id && a.mode === index) ? '' : 'disabled'}>${metadata[o.name]?.art ? `<img src="${escape(metadata[o.name].art)}" alt="" draggable="false">` : ''}<strong>${escape(mode.label)}</strong><span>${mana(castingProfile(state, viewer(), o, index)?.cost ?? spellProfile(definition(state, o), index).cost)}<br>${mode.target || mode.targetGroups ? 'Choose targets next.' : 'Cast with this option.'}</span></button>`).join('')}</div>`;
  openChoiceDialog(
    'Choose how to cast',
    o.name,
    body,
    '<button class="btn quiet" data-action="closeDialog">Cancel casting</button>',
    { eyebrow: 'CASTING OPTIONS', closeLabel: 'View battlefield' },
  );
  dialog._activeChoice = null;
  dialog._stageRender = showSpellModes;
  dialog._spellModeCard = ref(o);
  dialog._spellModeRevision = state.revision;
}
function showLegendChoice() {
  presentStateChoice();
}
function showLibrarySearch() {
  const choice = state.choice;
  if (choice?.kind !== 'librarySearch' || choice.player !== viewer()) return;
  if (dialog._searchChoice !== choice) {
    dialog._searchChoice = choice;
    dialog._searchCards = [];
  }
  const selected = dialog._searchCards,
    groups = new Map();
  for (const id of choice.cards) {
    const name = state.objects[id].name;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(id);
  }
  const picked = selected
    .map(
      (id, index) =>
        `<div class="choice-picked-entry"><button class="choice-picked-chip" data-action="searchRemove" data-cardid="${escape(id)}">${choice.destination === 'top' ? `${index + 1}. ` : ''}${escape(state.objects[id].name)} <span aria-hidden="true">×</span></button>${choice.destination === 'top' ? `<button class="icon-btn" data-action="searchReorder" data-index="${index}" data-direction="-1" aria-label="Move earlier" ${index === 0 ? 'disabled' : ''}>←</button><button class="icon-btn" data-action="searchReorder" data-index="${index}" data-direction="1" aria-label="Move later" ${index === selected.length - 1 ? 'disabled' : ''}>→</button>` : ''}</div>`,
    )
    .join('');
  const body = `<div class="decision-toolbar"><input type="search" data-choice-filter placeholder="Find a card…" aria-label="Filter available cards"><span>${choice.cards.length} matching cards · ${selected.length} selected</span></div><div class="choice-picked-tray">${picked || '<span>Choose from the cards below.</span>'}</div><div class="decision-card-grid">${
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ids]) => {
        const used = ids.filter((id) => selected.includes(id)).length;
        return decisionCard(state, ids[0], metadata, {
          viewer: viewer(),
          action: 'searchAdd',
          extra: `data-name="${escape(name)}"`,
          selected: used > 0,
          disabled: (selected.length >= choice.max && choice.max !== 1) || used === ids.length,
          badge: `${used ? `${used} selected · ` : ''}${ids.length} ${ids.length === 1 ? 'copy' : 'copies'}`,
        });
      })
      .join('') || '<div class="decision-empty"><p>No matching cards remain.</p></div>'
  }</div>`;
  const destination =
    choice.destination === 'top'
      ? 'on top of your library'
      : choice.destination === 'hand'
        ? 'into your hand'
        : choice.destination === 'graveyard'
          ? 'into your graveyard'
          : `onto the battlefield${choice.tapped ? ' tapped' : ''}`;
  openChoiceDialog(
    'Search your library',
    `Choose ${choice.min === choice.max ? choice.max : `up to ${choice.max}`} card${choice.max === 1 ? '' : 's'} to put ${destination}. Your library will be shuffled.`,
    body,
    `<span class="choice-selection-summary">${selected.length} of ${choice.max} selected</span><button class="btn primary" data-action="confirmSearch" ${selected.length < choice.min ? 'disabled' : ''}>${selected.length ? 'Confirm cards & shuffle' : 'Find none & shuffle'}</button>`,
    { source: state.resolving?.entry.name ?? '' },
  );
  dialog._activeChoice = choice;
  dialog._stageRender = showLibrarySearch;
}
function showLibraryOrder() {
  if (dialog._libraryChoice !== state.choice) {
    dialog._libraryOrder = { top: [...state.choice.cards], rest: [] };
    dialog._libraryChoice = state.choice;
  }
  renderLibraryOrder();
}
function renderLibraryOrder() {
  const order = dialog._libraryOrder,
    choice = state.choice;
  if (choice?.kind !== 'libraryOrder' || dialog._libraryChoice !== choice) return;
  const restLabel = choice.action === 'scry' ? 'Bottom of library' : 'Graveyard';
  const body = `<div class="decision-order-lanes">${[
    ['top', 'Top of library'],
    ['rest', restLabel],
  ]
    .map(
      ([key, label]) =>
        `<section class="decision-order-lane" data-order-drop="${key}"><h3>${label}</h3><p>${key === 'top' ? 'Leftmost card will be drawn first.' : choice.action === 'scry' ? 'These cards go below the rest of your library.' : 'These cards go to your graveyard.'}</p><div class="decision-card-gallery" style="--choice-count:${Math.max(1, order[key].length)}">${order[key].map((id, i) => decisionCard(state, id, metadata, { viewer: viewer(), action: 'libraryMove', extra: `data-group="${key === 'top' ? 'rest' : 'top'}"`, draggable: true, badge: key === 'top' ? (i === 0 ? 'Draw first' : `Draw ${i + 1}`) : restLabel, label: `Move ${state.objects[id].name} to ${key === 'top' ? restLabel : 'top of library'}` }).replace('</article>', `<div class="decision-order-controls"><button data-action="libraryMove" data-cardid="${id}" data-group="${key === 'top' ? 'rest' : 'top'}">${key === 'top' ? (choice.action === 'scry' ? 'Bottom' : 'Graveyard') : 'Keep on top'}</button><button data-action="libraryReorder" data-group="${key}" data-index="${i}" data-direction="-1" aria-label="Move ${escape(state.objects[id].name)} earlier" ${i === 0 ? 'disabled' : ''}>←</button><button data-action="libraryReorder" data-group="${key}" data-index="${i}" data-direction="1" aria-label="Move ${escape(state.objects[id].name)} later" ${i === order[key].length - 1 ? 'disabled' : ''}>→</button></div></article>`)).join('') || '<div class="decision-empty"><span>◇</span><p>Move cards here</p></div>'}</div></section>`,
    )
    .join('')}</div>`;
  openChoiceDialog(
    `${choice.action === 'scry' ? 'Scry' : 'Surveil'} ${choice.cards.length}`,
    'Click a card to move it between destinations, or drag it. Use the arrows to set the draw order.',
    body,
    `<span class="choice-selection-summary">${order.top.length} on top · ${order.rest.length} ${choice.action === 'scry' ? 'on bottom' : 'to graveyard'}</span><button class="btn primary" data-action="submitLibrary">Confirm arrangement</button>`,
    { source: state.resolving?.entry.name ?? '' },
  );
  dialog._libraryOrder = order;
  dialog._activeChoice = choice;
  dialog._stageRender = renderLibraryOrder;
}
function showDamage() {
  const orders = suggestedDamage(state);
  openDialog(
    'Assign combat damage',
    `<p style="margin-bottom:18px">Assign each creature’s full power. Trample can reach the player only after every blocker is assigned lethal damage.</p><div id="damage-orders">${orders.map((o, i) => `<h3 style="margin:16px 0 10px">${escape(state.objects[o.source].name)}</h3>${o.assignments.map((a, j) => `<div class="choice-row"><strong>${escape(a.target.kind === 'player' ? state.players[a.target.id].name : state.objects[a.target.id].name)}</strong><label>Damage<input type="number" min="0" step="1" value="${a.amount}" data-damage="${i}:${j}"></label></div>`).join('')}`).join('')}</div>`,
    '<button class="btn" data-action="closeDialog">Cancel</button><button class="btn primary" data-action="submitDamage">Assign damage</button>',
  );
  dialog._orders = orders;
}
function showTriggerOrder() {
  const ids = state.choice.entries.map((e) => e.id);
  dialog._triggerIds = ids;
  renderTriggerOrder();
}
function renderTriggerOrder() {
  const ids = dialog._triggerIds;
  openDialog(
    'Order triggered abilities',
    `<p style="margin-bottom:18px">Bottom to top. The last ability listed resolves first.</p>${ids
      .map((id, i) => {
        const e = state.choice.entries.find((e) => e.id === id);
        return `<div class="choice-row"><span class="muted">${i + 1}</span><strong>${escape(e.label)}</strong><div class="trigger-order"><button class="icon-btn" data-action="moveTrigger" data-id="${id}" data-direction="-1" aria-label="Move down the stack" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn" data-action="moveTrigger" data-id="${id}" data-direction="1" aria-label="Move up the stack" ${i === ids.length - 1 ? 'disabled' : ''}>↓</button></div></div>`;
      })
      .join('')}`,
    '<button class="btn primary" data-action="submitTriggers">Put on stack</button>',
  );
  dialog._triggerIds = ids;
}
function replayTo(index) {
  const record = ui.replayRecord;
  try {
    state = replay({ ...record, commands: record.commands.slice(0, index) });
    ui.replayIndex = index;
    if (!ui.inspect) ui.inspect = state.stack.at(-1)?.name ?? null;
    resetSelection();
    render();
  } catch (e) {
    toast(e.message);
  }
}
function showCastingSacrifice(command, sacrifice) {
  const object = state.objects[command.card];
  const profile = castingProfile(
    state,
    viewer(),
    object,
    command.mode,
    command.targets ? flattenTargets(command.targets) : command.target,
    undefined,
    command.x,
  );
  if (!profile || command.expectedRevision !== state.revision) {
    toast('The game changed. Choose this spell again.');
    return;
  }
  const candidates = castingSacrificeCandidates(state, viewer(), profile);
  const payment = sacrifice && castingPayment(state, viewer(), profile, { ...command, sacrifice });
  const body = `<p>As an additional casting cost, sacrifice one eligible permanent. This happens before opponents can respond, even if the spell is countered. Mana cost: ${mana(profile.cost)}.</p><div class="decision-card-grid">${candidates.map((o) => `<section>${decisionCard(state, o.id, metadata, { viewer: viewer(), action: 'readDecisionCard', selected: sacrifice?.id === o.id })}<button class="btn ${sacrifice?.id === o.id ? 'primary' : ''}" data-action="selectCastingSacrifice" data-cardid="${o.id}" aria-pressed="${sacrifice?.id === o.id}">Sacrifice ${escape(o.name)}</button></section>`).join('')}</div>`;
  openChoiceDialog(
    'Choose additional sacrifice',
    object.name,
    body,
    `<button class="btn" data-action="closeDialog">Cancel</button><span>${sacrifice ? `Sacrifice: ${escape(state.objects[sacrifice.id]?.name ?? '')}. ${payment ? 'Payment is available.' : 'Cannot pay with this selection.'}` : 'Choose one permanent.'}</span><button class="btn primary" data-action="confirmCastingSacrifice" ${payment ? '' : 'disabled'}>Confirm sacrifice and ${profile.keywords.includes('convoke') ? 'choose convoke' : 'cast'}</button>`,
    { source: object.name },
  );
  dialog._castingSacrificeDraft = { command, sacrifice };
  dialog._activeChoice = null;
  dialog._stageRender = () => showCastingSacrifice(command, sacrifice);
}
function showConvoke(command, choices) {
  const object = state.objects[command.card];
  const profile = castingProfile(
    state,
    viewer(),
    object,
    command.mode,
    command.targets ? flattenTargets(command.targets) : command.target,
    undefined,
    command.x,
  );
  if (!profile || command.expectedRevision !== state.revision) {
    toast('The game changed. Choose this spell again.');
    return;
  }
  choices ??= castingPayment(state, viewer(), profile, command)?.choices ?? [];
  const payment = castingPayment(state, viewer(), profile, { ...command, convoke: choices });
  const candidates = convokeCandidates(state, viewer());
  const body = `<p>Total locked cost: ${mana(profile.cost)}. Each creature pays one matching colored symbol or one generic mana. Newly entered creatures may convoke.</p><div class="decision-card-grid">${candidates
    .map((o) => {
      const chosen = choices.find((c) => c.card === o.id)?.symbol;
      const symbols = Object.keys(profile.cost).filter(
        (symbol) =>
          profile.cost[symbol] > 0 &&
          (symbol === 'generic' ||
            (symbol !== 'C' &&
              symbol.split('/').some((color) => definition(state, o).color?.includes(color)))),
      );
      return `<section>${decisionCard(state, o.id, metadata, { viewer: viewer(), action: 'readDecisionCard', selected: chosen !== undefined })}<div>${symbols.map((symbol) => `<button class="btn ${chosen === symbol ? 'primary' : ''}" data-action="selectConvoke" data-cardid="${o.id}" data-symbol="${symbol}" aria-pressed="${chosen === symbol}">Pay ${symbol === 'generic' ? '{1}' : `{${symbol}}`}</button>`).join('')}<button class="btn" data-action="selectConvoke" data-cardid="${o.id}" data-symbol="">Do not tap</button></div></section>`;
    })
    .join('')}</div>`;
  openChoiceDialog(
    'Choose creatures to convoke',
    object.name,
    body,
    `<button class="btn" data-action="closeDialog">Cancel</button><span>${choices.length} creatures selected. ${payment ? `Remaining mana: ${mana(payment.cost)}. Auto-tap: ${payment.mana.activations.map((a) => escape(state.objects[a.card].name)).join(', ') || 'none'}.` : 'Cannot pay with this selection; choose other creatures or symbols.'}</span><button class="btn primary" data-action="confirmConvoke" ${payment ? '' : 'disabled'}>Confirm payment and cast</button>`,
    { source: object.name },
  );
  dialog._convokeDraft = { command, choices };
  dialog._activeChoice = null;
  dialog._stageRender = () => showConvoke(command, choices);
}
function showSettings() {
  openDialog(
    'Table preferences',
    `<div class="options-row"><label class="toggle"><input type="checkbox" id="auto-yield" ${ui.autoYield ? 'checked' : ''}>Yield when no response is available</label><label class="toggle"><input type="checkbox" id="hold-priority" ${ui.holdPriority ? 'checked' : ''}>Hold priority after casting</label><label class="toggle"><input type="checkbox" id="reduce-motion" ${ui.reduceMotion ? 'checked' : ''}>Reduce motion</label></div><p class="small muted">System reduced-motion preferences are always respected.</p><p style="margin-top:22px">Automatic yielding stops whenever you can cast a spell. Disable it to inspect every priority window. Mana sources are paid automatically when casting, or click a land to float mana manually.</p><p style="margin-top:12px">Drag a card onto your field to play, or onto a highlighted target to cast. Drag creatures toward your opponent to select attackers, or onto an attacker to assign a blocker, then confirm the group. Keyboard: Space passes priority. Escape cancels a drag or card selection. All match controls are reachable with Tab.</p>`,
  );
}
function groupedTargetContext() {
  const choice = state.choice?.kind === 'triggerTargets' ? state.choice : null;
  const object = state.objects[ui.selected];
  const ability =
    !choice && ui.activation !== null && object?.zone === 'battlefield'
      ? definition(state, object).activated?.[ui.activation]
      : null;
  const profile =
    choice?.entry ??
    ability ??
    (object ? spellProfile(definition(state, object), ui.spellMode ?? undefined) : null);
  if (!profile?.targetGroups) return null;
  const command = choice
    ? { type: 'chooseTriggerTargets' }
    : ability
      ? { type: 'activate', card: object.id, ability: ui.activation }
      : { type: 'cast', card: object.id, ...(ui.spellMode != null ? { mode: ui.spellMode } : {}) };
  return { choice, object, ability, profile, command, name: choice?.entry.name ?? object.name };
}
function groupedTargetProblem(context, plan) {
  if (context.choice) return targetPlanProblem(state, context.profile.targetGroups, plan, viewer());
  if (context.ability)
    return abilityProblem(state, viewer(), context.object.id, ui.activation, null, undefined, plan);
  return castProblem(state, viewer(), context.object.id, null, {
    mode: ui.spellMode ?? undefined,
    x: ui.x ?? undefined,
    targets: plan,
  });
}
function showGroupedTargets() {
  const context = groupedTargetContext();
  if (!context) return;
  const { object, profile, choice, ability, name } = context;
  const groups = profile.targetGroups;
  const key = `${state.revision}:${choice?.entry.id ?? object.id}:${ui.spellMode}:${ui.activation}`;
  if (dialog._groupKey !== key) {
    dialog._groupKey = key;
    dialog._groupIndex = 0;
    dialog._groupPlan = Object.fromEntries(groups.map((g) => [g.id, []]));
  }
  const index = dialog._groupIndex,
    group = groups[index],
    plan = dialog._groupPlan;
  const candidates = targetGroupCandidates(state, groups, group.id, viewer(), plan);
  const chosen = plan[group.id];
  const matches = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const body = `<div class="decision-toolbar"><span>Step ${index + 1} of ${groups.length} · Choose ${group.min === group.max ? group.min : `${group.min}–${group.max}`}</span></div><div class="decision-card-gallery ${candidates.length <= 3 ? 'decision-hero' : 'decision-many'}" style="--choice-count:${Math.max(1, candidates.length)}">${
    candidates
      .map((target, i) => {
        const selected = chosen.some((t) => matches(t, target));
        const card =
          target.kind === 'object'
            ? state.objects[target.id]
            : target.kind === 'stack'
              ? state.objects[state.stack.find((e) => e.id === target.id)?.source?.id]
              : null;
        if (card)
          return decisionCard(state, card.id, metadata, {
            viewer: viewer(),
            action: 'selectGroupTarget',
            extra: `data-index="${i}"`,
            selected,
          });
        const label = state.players[target.id]?.name ?? 'Target';
        return `<article class="decision-player-tile ${selected ? 'is-selected' : ''}"><button class="decision-player-option" data-action="selectGroupTarget" data-index="${i}" aria-pressed="${selected}"><strong>${escape(label)}</strong><span class="decision-selected-mark">✓</span></button></article>`;
      })
      .join('') || '<div class="decision-empty">No legal targets in this group.</div>'
  }</div>`;
  const validStep = chosen.length >= group.min && chosen.length <= group.max;
  const last = index === groups.length - 1;
  const problem = groupedTargetProblem(context, plan);
  const cost = choice
    ? null
    : ability
      ? (ability.cost.mana ?? {})
      : castingProfile(
          state,
          viewer(),
          object,
          ui.spellMode ?? undefined,
          flattenTargets(plan),
          undefined,
          ui.x ?? undefined,
        ).cost;
  openChoiceDialog(
    group.label ?? 'Choose targets',
    name,
    body,
    `${index ? '<button class="btn" data-action="previousTargetGroup">Back</button>' : ''}<span class="decision-selection-summary">${chosen.length} selected · ${cost ? mana(cost) : 'Triggered ability'}${last && problem ? `<small>${escape(problem)}</small>` : ''}</span><button class="btn primary" data-action="nextTargetGroup" ${validStep && (!last || !problem) ? '' : 'disabled'}>${last ? (choice ? 'Confirm targets' : ability ? 'Confirm and activate' : 'Confirm and cast') : 'Next targets'}</button>`,
    { source: name },
  );
  dialog._activeChoice = choice;
  dialog._groupCandidates = candidates;
  dialog._groupRevision = state.revision;
  dialog._groupDefinitions = groups;
  dialog._stageRender = showGroupedTargets;
}

function showTargetMenu() {
  if (groupedTargetContext()) {
    showGroupedTargets();
    return;
  }
  const choice = state.choice;
  const commands =
    choice?.kind === 'triggerTarget'
      ? choice.targets.map((target) => ({ type: 'chooseTriggerTarget', target }))
      : legalActions(state, viewer(), { x: ui.x ?? undefined }).filter(
          (command) =>
            command.card === ui.selected &&
            command.target &&
            command.type === (ui.activation === null ? 'cast' : 'activate') &&
            (ui.activation === null
              ? command.mode === (ui.spellMode ?? undefined) && command.x === (ui.x ?? undefined)
              : command.ability === ui.activation),
        );
  const key = `${state.revision}:${ui.selected}:${ui.activation}:${ui.spellMode}:${choice?.entry?.id ?? ''}`;
  if (dialog._targetKey !== key) {
    dialog._selectedTargetIndex = -1;
    dialog._targetKey = key;
    dialog._choiceQuery = '';
  }
  const selected = dialog._selectedTargetIndex;
  const name =
    choice?.kind === 'triggerTarget' ? choice.entry.name : state.objects[ui.selected]?.name;
  const body = `<div class="decision-toolbar"><input type="search" data-choice-filter placeholder="Find a target…" aria-label="Filter legal targets"><span>${commands.length} legal target${commands.length === 1 ? '' : 's'}</span></div><div class="${commands.length > 7 ? 'decision-card-grid' : `decision-card-gallery ${commands.length <= 3 ? 'decision-hero' : 'decision-many'}`}" style="--choice-count:${Math.max(1, commands.length)}">${
    commands
      .map((command, index) => {
        const target = command.target,
          object =
            target.kind === 'object'
              ? state.objects[target.id]
              : target.kind === 'stack'
                ? state.objects[state.stack.find((e) => e.id === target.id)?.source?.id]
                : null;
        if (object)
          return decisionCard(state, object.id, metadata, {
            viewer: viewer(),
            action: 'selectTargetCard',
            extra: `data-index="${index}"`,
            selected: selected === index,
            badge:
              target.kind === 'stack'
                ? 'On the stack'
                : `${object.owner === viewer() ? 'Your' : "Opponent's"} ${object.zone}`,
          });
        const label = target.kind === 'player' ? state.players[target.id].name : 'Stack target';
        return `<article class="decision-player-tile ${selected === index ? 'is-selected' : ''}" data-search="${escape(label.toLowerCase())}"><button class="decision-player-option" data-action="selectTargetCard" data-index="${index}" aria-pressed="${selected === index}"><span class="decision-avatar">${target.kind === 'player' ? state.players[target.id].life : '◇'}</span><strong>${escape(label)}</strong><span>${target.kind === 'player' ? 'Player · life total' : 'Stack object'}</span><span class="decision-selected-mark">✓</span></button></article>`;
      })
      .join('') || '<div class="decision-empty"><p>No legal targets remain.</p></div>'
  }</div>`;
  const selectedCommand = commands[selected];
  const selectedCost =
    selectedCommand?.type === 'cast'
      ? castingProfile(
          state,
          viewer(),
          state.objects[selectedCommand.card],
          selectedCommand.mode,
          selectedCommand.target,
          undefined,
          selectedCommand.x,
        )?.cost
      : null;
  openChoiceDialog(
    'Choose a target',
    `Select a legal target for ${name}, then confirm.`,
    body,
    `<span class="choice-selection-summary">${selected >= 0 ? '1 target selected' : 'Select a target above'}${selectedCost ? `<strong>Cast cost ${mana(selectedCost)}</strong>` : ''}</span><button class="btn primary" data-action="confirmTargetChoice" ${selected >= 0 ? '' : 'disabled'}>Confirm target</button>`,
    { source: name },
  );
  dialog._targetCommands = commands;
  dialog._targetRevision = state.revision;
  dialog._activeChoice = choice?.kind === 'triggerTarget' ? choice : null;
  dialog._stageRender = showTargetMenu;
}
function showPublicZone(player, zone) {
  if (![0, 1].includes(player) || !['graveyard', 'exile'].includes(zone)) return;
  const key = `${state.revision}:${player}:${zone}`;
  if (dialog._zoneKey !== key) {
    dialog._zoneKey = key;
    dialog._choiceQuery = '';
  }
  const cards = state.players[player][zone];
  const body = `<div class="decision-toolbar"><input type="search" data-choice-filter placeholder="Find a card…" aria-label="Filter zone cards"><span>${cards.length} card${cards.length === 1 ? '' : 's'}</span></div><div class="decision-card-grid">${cards.map((id) => decisionCard(state, id, metadata, { viewer: viewer(), action: 'readDecisionCard', label: `Read ${state.objects[id].name}` })).join('') || '<div class="decision-empty"><span>◇</span><p>This zone is empty.</p></div>'}</div>`;
  openChoiceDialog(
    player === viewer() ? `Your ${zone}` : `Opponent's ${zone}`,
    state.players[player].name,
    body,
    '<button class="btn primary" data-action="closeDialog">Back to battlefield</button>',
    { eyebrow: 'PUBLIC ZONE' },
  );
  dialog._activeChoice = null;
  dialog._stageRender = () => showPublicZone(player, zone);
}
function preserveDraft() {
  ui.recoveredDraft = ui.deckDraft;
  try {
    localStorage.setItem('leyline.deck-draft.v1', JSON.stringify(ui.deckDraft));
  } catch {}
}
function editDeck(draft) {
  ui.deckDraft = structuredClone(draft);
  ui.builderPanel = 'pool';
  ui.builderScroll = {};
  ui.builderQuery = '';
  ui.builderColor = 'all';
  ui.builderType = 'all';
  ui.view = 'builder';
  preserveDraft();
  render();
  window.scrollTo(0, 0);
}
function saveDraft(select = false) {
  const draft = ui.deckDraft;
  if (!draft.name.trim()) {
    toast('Give your deck a name first.');
    return;
  }
  const id = draft.id ?? `personal-${crypto.randomUUID()}`;
  const next = { id, name: draft.name.trim(), cards: { ...draft.cards } };
  const library = [...ui.personalDecks.filter((d) => d.id !== id), next];
  if (library.length > 100) {
    toast('This device already has 100 saved decks.');
    return;
  }
  try {
    localStorage.setItem(DECK_LIBRARY_KEY, JSON.stringify(library));
  } catch {
    toast('Could not save the deck. Export the list to keep your changes.');
    return;
  }
  ui.personalDecks = library;
  ui.deckDraft.id = id;
  preserveDraft();
  toast('Deck saved on this device.');
  if (select) {
    ui.deck = id;
    ui.customDeck = null;
    ui.view = 'decks';
  }
  render();
}
async function action(name, el) {
  switch (name) {
    case 'toggleFullControl':
      ui.controlMode = ui.controlMode === 'full' ? 'smart' : 'full';
      ui.yieldMode = null;
      save();
      render();
      break;
    case 'yieldResponse':
    case 'yieldTurn':
      ui.yieldMode = name === 'yieldTurn' ? 'turn' : 'response';
      ui.yieldTurn = state.turn;
      ui.controlMode = 'smart';
      resetSelection();
      render();
      break;
    case 'cancelYield':
      ui.yieldMode = null;
      render();
      break;
    case 'toggleStop': {
      const key = el.dataset.stop;
      ui.stops[key] = !ui.stops[key];
      save();
      render();
      if (dialog.open) action('phaseStops', {});
      break;
    }
    case 'phaseStops': {
      const steps = [
        ['upkeep', 'Upkeep'],
        ['draw', 'Draw'],
        ['main1', 'First main'],
        ['beginCombat', 'Begin combat'],
        ['attackers', 'After attackers'],
        ['blockers', 'After blockers'],
        ['firstDamage', 'First strike'],
        ['damage', 'After damage'],
        ['endCombat', 'End combat'],
        ['main2', 'Second main'],
        ['end', 'End step'],
      ];
      openDialog(
        'Set a stop',
        `<p>Stop at the next matching step even with no playable cards. A manual pass consumes that stop. You can set a stop while an animation is playing.</p><div class="stop-columns">${['you', 'opponent'].map((side) => `<section><h3>${side === 'you' ? 'Your turn' : 'Opponent’s turn'}</h3>${steps.map(([step, label]) => `<button class="btn ${ui.stops[`${side}:${step}`] ? 'stop-on' : ''}" data-action="toggleStop" data-stop="${side}:${step}" aria-pressed="${!!ui.stops[`${side}:${step}`]}">${ui.stops[`${side}:${step}`] ? '●' : '○'} ${label}</button>`).join('')}</section>`).join('')}</div>`,
      );
      break;
    }
    case 'handSize': {
      const anchor = readableHandCard(state, ui, viewer());
      ui.handExpanded = !ui.handExpanded;
      save();
      render();
      if (anchor)
        app
          .querySelector(`.hand [data-card="${CSS.escape(anchor)}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      break;
    }
    case 'prioritySettings':
      openDialog(
        'Priority & automation',
        `<p>Smart play skips empty response windows and responses to your own effects. Full control stops at every priority window. Phase stops override both passing shortcuts.</p><div class="priority-settings"><label><input id="auto-order-triggers" type="checkbox" ${ui.autoOrderTriggers ? 'checked' : ''}> Automatically order my triggers</label><label><input id="auto-damage" type="checkbox" ${ui.autoDamage ? 'checked' : ''}> Use suggested combat damage</label></div><p>Targets, attacks, blocks, optional effects and discards always remain your decisions.</p>`,
      );
      break;
    case 'resumeDraft':
      if (ui.recoveredDraft) editDeck(ui.recoveredDraft);
      break;
    case 'newDeck':
      editDeck({ name: 'Untitled deck', cards: {} });
      break;
    case 'editDeck': {
      const deck = selectedDeck(ui);
      editDeck({
        name: deck.personal ? deck.name : `${deck.name} — my list`,
        cards: deck.cards,
        ...(deck.personal ? { id: ui.deck } : {}),
      });
      break;
    }
    case 'builderPanel': {
      const panel = el.dataset.panel;
      if (!['pool', 'list'].includes(panel) || !ui.deckDraft) break;
      const selector = (p) => (p === 'list' ? '.builder-list-scroll' : '.builder-cards');
      ui.builderScroll[ui.builderPanel] =
        app.querySelector(selector(ui.builderPanel))?.scrollTop ?? 0;
      ui.builderPanel = panel;
      render();
      const target = app.querySelector(selector(panel));
      if (target) target.scrollTop = ui.builderScroll[panel] ?? 0;
      break;
    }
    case 'inspectDraftCard': {
      const name = el.dataset.name;
      if (!ui.deckDraft || !CARDS[name]) break;
      openDialog(name, inspect(name, metadata));
      break;
    }
    case 'closeBuilder':
      preserveDraft();
      ui.view = 'decks';
      render();
      break;
    case 'deckColor':
      ui.deckColor = el.dataset.color;
      render();
      break;
    case 'addDraftCard': {
      const n = el.dataset.name,
        d = CARDS[n];
      if (!ui.deckDraft || !d || d.token) break;
      const count = ui.deckDraft.cards[n] ?? 0;
      if (
        Object.values(ui.deckDraft.cards).reduce((a, b) => a + b, 0) >= 250 ||
        (!d.basic && count >= 4)
      )
        break;
      ui.deckDraft.cards[n] = count + 1;
      preserveDraft();
      render();
      break;
    }
    case 'removeDraftCard': {
      const n = el.dataset.name;
      if (!ui.deckDraft?.cards[n]) break;
      if (--ui.deckDraft.cards[n] <= 0) delete ui.deckDraft.cards[n];
      preserveDraft();
      render();
      break;
    }
    case 'saveDraft':
      saveDraft();
      break;
    case 'saveAndPlayDraft':
      saveDraft(true);
      break;
    case 'exportDraft': {
      const blob = new Blob(
        [
          'Deck\n' +
            Object.entries(ui.deckDraft.cards)
              .map(([n, c]) => `${c} ${n}`)
              .join('\n'),
        ],
        { type: 'text/plain' },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'leyline-deck.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case 'confirmStart':
      closeDialog();
      startConfirmed();
      break;

    case 'home':
    case 'newMatch':
      if (state && state.status !== 'finished' && !ui.replayRecord) {
        openDialog(
          'Leave this table?',
          '<p>Your current match is saved on this device. You can resume it from the play screen.</p>',
          '<button class="btn" data-action="closeDialog">Stay</button><button class="btn primary" data-action="leave">Leave table</button>',
        );
      } else {
        state = null;
        ui.replayRecord = null;
        ui.view = 'play';
        render();
      }
      break;
    case 'leave':
      closeDialog();
      state = null;
      ui.replayRecord = null;
      ui.view = 'play';
      render();
      break;
    case 'nav':
      ui.view = el.dataset.view;
      render();
      window.scrollTo(0, 0);
      break;
    case 'selectDeck':
      ui.deck = el.dataset.deck;
      if (!deckEntries(ui).some(([id]) => id === ui.deck)) ui.deck = 'ember';
      ui.customDeck = null;
      ui.catalog = CARDS;
      render();
      break;
    case 'start':
      start();
      break;
    case 'resume':
      try {
        const saved = JSON.parse(readSave());
        state = replay(saved.replay);
        ui.catalog = state.catalog;
        ui.mode = saved.mode;
        ui.deck = deckEntries(ui).some(([id]) => id === saved.deck) ? saved.deck : 'storm-rakdos';
        ui.customDeck =
          saved.customDeck ??
          (JSON.stringify(state.config.decks[0]) ===
          JSON.stringify(expandDeck(selectedDeck(ui).cards))
            ? null
            : state.config.decks[0]);
        ui.autoYield = saved.autoYield ?? true;
        ui.holdPriority = saved.holdPriority ?? false;
        if (saved.controls) {
          ui.controlMode = saved.controls.controlMode === 'full' ? 'full' : 'smart';
          ui.stops = saved.controls.stops ?? {};
          ui.autoOrderTriggers = saved.controls.autoOrderTriggers !== false;
          ui.autoDamage = saved.controls.autoDamage !== false;
          ui.handExpanded = saved.controls.handExpanded !== false;
        }
        ui.yieldMode = null;
        ui.seat = state.choice?.player ?? state.priority;
        ui.replayRecord = null;
        ui.view = 'play';
        resetSelection();
        render();
      } catch (e) {
        toast(`Could not resume: ${e.message}`);
      }
      break;
    case 'deckList':
      showDeck();
      break;
    case 'importDeck':
      openDialog(
        'Bring your own deck',
        `<p style="margin-bottom:16px">Paste a 60-card list. Arena-style set codes are accepted. Only executable cards in the catalog are supported. No silent substitutions.</p><textarea id="deck-input" aria-label="Deck list" placeholder="12 Mountain\n12 Island\n4 Lightning Bolt\n…"></textarea><div id="deck-errors" class="error-list"></div>`,
        '<button class="btn" data-action="closeDialog">Cancel</button><button class="btn primary" data-action="validateDeck">Open in deck builder</button>',
      );
      break;
    case 'validateDeck': {
      const result = parseDeck(document.querySelector('#deck-input').value, {
        catalog: ui.catalog,
      });
      const structural = result.errors.filter((error) => error.startsWith('Line '));
      if (structural.length || result.names.length > 250 || !result.names.length) {
        document.querySelector('#deck-errors').textContent =
          structural.join('\n') || 'Import between 1 and 250 main-deck cards.';
        break;
      }
      const cards = Object.fromEntries(
        [...new Set(result.names)].map((name) => [
          name,
          result.names.filter((n) => n === name).length,
        ]),
      );
      closeDialog();
      editDeck({ name: 'Imported deck', cards });
      break;
    }
    case 'reviewDecision':
      presentStateChoice();
      break;
    case 'selectDecisionCard':
      selectDecisionCard(el.dataset.cardid);
      break;
    case 'confirmDecision':
      confirmDecision();
      break;
    case 'declineDecision':
      confirmDecision(true);
      break;
    case 'readDecisionCard': {
      const restore = dialog._stageRender;
      openChoiceDialog(
        'A closer look',
        'Read the card, then return to your decision.',
        decisionReader(state, el.dataset.cardid, metadata, viewer()),
        '<button class="btn primary" data-action="returnDecision">Back to cards</button>',
      );
      dialog._returnStage = restore;
      break;
    }
    case 'returnDecision':
      dialog._returnStage?.();
      break;
    case 'acceptOptional':
    case 'declineOptional':
      send({ type: 'resolveOptional', accept: name === 'acceptOptional' });
      break;
    case 'chooseMana':
      if (
        send(
          { type: 'tapMana', card: dialog._manaCard, color: el.dataset.color },
          { autoPass: false },
        )
      )
        closeDialog();
      break;
    case 'chooseResolutionCard':
    case 'skipResolutionCard':
      send({
        type: 'chooseResolutionCard',
        card: name === 'skipResolutionCard' ? null : el.dataset.cardid,
      });
      break;
    case 'chooseCreatureType':
      send({
        type: 'chooseCreatureType',
        creatureType: document.getElementById('entry-creature-type')?.value,
      });
      break;
    case 'payWard':
    case 'declineWard':
      send({ type: 'payCost', pay: name === 'payWard' });
      break;
    case 'keep':
    case 'mulligan':
      send({ type: name });
      break;
    case 'submitCards':
      send({ type: state.choice.kind, cards: [...ui.chosen] });
      break;
    case 'allAttack':
      ui.chosen = controlledCreatures(viewer())
        .filter((o) => canAttack(state, o, viewer()))
        .map((o) => o.id);
      render();
      break;
    case 'attack':
      send({ type: 'attackers', cards: [...ui.chosen] });
      break;
    case 'block':
      send({ type: 'blockers', pairs: [...ui.blocks] });
      break;
    case 'damage':
      send({ type: 'assignDamage', orders: suggestedDamage(state) });
      break;
    case 'legendRule':
      showLegendChoice();
      break;
    case 'keepLegend':
      if (
        state.choice?.kind === 'legendRule' &&
        state.choice.player === viewer() &&
        dialog._legendChoice === state.choice
      ) {
        if (send({ type: 'chooseLegend', card: el.dataset.cardid })) closeDialog();
      }
      break;
    case 'readLegend': {
      if (state.choice?.kind !== 'legendRule' || !state.choice.cards.includes(el.dataset.cardid))
        break;
      const o = state.objects[el.dataset.cardid];
      openDialog(
        o.name,
        inspect(o.name, metadata, state, o.id),
        '<button class="btn primary" data-action="legendRule">Back to legend choice</button>',
      );
      break;
    }
    case 'librarySearch':
      showLibrarySearch();
      break;
    case 'searchAdd': {
      if (
        state.choice?.kind !== 'librarySearch' ||
        state.choice.player !== viewer() ||
        dialog._searchChoice !== state.choice
      )
        break;
      if (
        state.choice.max === 1 &&
        !dialog._searchCards.some((id) => state.objects[id].name === el.dataset.name)
      )
        dialog._searchCards = [];
      const selected = dialog._searchCards;
      const id = state.choice.cards.find(
        (id) => state.objects[id].name === el.dataset.name && !selected.includes(id),
      );
      if (id && selected.length < state.choice.max) selected.push(id);
      showLibrarySearch();
      break;
    }
    case 'searchRemove':
      if (dialog._searchChoice !== state.choice) break;
      dialog._searchCards = dialog._searchCards.filter((id) => id !== el.dataset.cardid);
      showLibrarySearch();
      break;
    case 'searchReorder': {
      if (dialog._searchChoice !== state.choice) break;
      const i = Number(el.dataset.index),
        j = i + Number(el.dataset.direction),
        cards = dialog._searchCards;
      if (Number.isInteger(i) && j >= 0 && i >= 0 && j < cards.length && i < cards.length)
        [cards[i], cards[j]] = [cards[j], cards[i]];
      showLibrarySearch();
      break;
    }
    case 'readSearchCard':
      if (
        state.choice?.kind !== 'librarySearch' ||
        state.choice.player !== viewer() ||
        !state.choice.cards.some((id) => state.objects[id].name === el.dataset.name)
      )
        break;
      openDialog(
        el.dataset.name,
        inspect(el.dataset.name, metadata),
        '<button class="btn primary" data-action="librarySearch">Back to search</button>',
      );
      break;
    case 'confirmSearch':
      if (dialog._searchChoice !== state.choice) break;
      {
        const command = {
          type: 'searchLibrary',
          cards: [...dialog._searchCards],
          expectedRevision: dialog._choiceRevision,
        };
        closeDialog();
        send(command);
      }
      break;
    case 'libraryOrder':
      showLibraryOrder();
      break;
    case 'libraryMove': {
      if (
        state.choice?.kind !== 'libraryOrder' ||
        dialog._libraryChoice !== state.choice ||
        !state.choice.cards.includes(el.dataset.cardid) ||
        !['top', 'rest'].includes(el.dataset.group)
      )
        break;
      const order = dialog._libraryOrder,
        id = el.dataset.cardid;
      order.top = order.top.filter((x) => x !== id);
      order.rest = order.rest.filter((x) => x !== id);
      order[el.dataset.group].push(id);
      renderLibraryOrder();
      break;
    }
    case 'libraryReorder': {
      if (
        state.choice?.kind !== 'libraryOrder' ||
        dialog._libraryChoice !== state.choice ||
        !['top', 'rest'].includes(el.dataset.group)
      )
        break;
      const group = dialog._libraryOrder[el.dataset.group],
        i = Number(el.dataset.index),
        j = i + Number(el.dataset.direction);
      if (!Number.isInteger(i) || i < 0 || j < 0 || i >= group.length || j >= group.length) break;
      [group[i], group[j]] = [group[j], group[i]];
      renderLibraryOrder();
      break;
    }
    case 'submitLibrary': {
      const order = structuredClone(dialog._libraryOrder);
      closeDialog();
      send({ type: 'orderLibrary', ...order, expectedRevision: dialog._choiceRevision });
      break;
    }
    case 'editDamage':
      showDamage();
      break;
    case 'submitDamage': {
      const orders = structuredClone(dialog._orders);
      for (const input of dialog.querySelectorAll('[data-damage]')) {
        const [i, j] = input.dataset.damage.split(':').map(Number);
        orders[i].assignments[j].amount = Number(input.value);
      }
      const ok = send({ type: 'assignDamage', orders });
      if (ok) closeDialog();
      break;
    }
    case 'triggerTargets':
    case 'spellTargets':
      showTargetMenu();
      break;
    case 'selectGroupTarget': {
      if (dialog._groupRevision !== state.revision) break;
      const group = dialog._groupDefinitions[dialog._groupIndex];
      const target = dialog._groupCandidates[Number(el.dataset.index)];
      if (!target) break;
      const chosen = dialog._groupPlan[group.id];
      const index = chosen.findIndex((t) => JSON.stringify(t) === JSON.stringify(target));
      if (index >= 0) chosen.splice(index, 1);
      else if (group.max === 1) chosen.splice(0, chosen.length, target);
      else if (chosen.length < group.max) chosen.push(target);
      else {
        toast(`Choose at most ${group.max} targets.`);
        break;
      }
      for (const later of dialog._groupDefinitions.slice(dialog._groupIndex + 1))
        dialog._groupPlan[later.id] = [];
      showGroupedTargets();
      break;
    }
    case 'previousTargetGroup':
      if (dialog._groupRevision === state.revision && dialog._groupIndex > 0) {
        dialog._groupIndex--;
        showGroupedTargets();
      }
      break;
    case 'selectCastingSacrifice': {
      const draft = dialog._castingSacrificeDraft;
      if (!draft || draft.command.expectedRevision !== state.revision) break;
      showCastingSacrifice(draft.command, ref(state.objects[el.dataset.cardid]));
      break;
    }
    case 'confirmCastingSacrifice': {
      const draft = dialog._castingSacrificeDraft;
      if (!draft?.sacrifice || draft.command.expectedRevision !== state.revision) break;
      const command = { ...draft.command, sacrifice: draft.sacrifice };
      closeDialog();
      send(command);
      break;
    }
    case 'selectConvoke': {
      const draft = dialog._convokeDraft;
      if (!draft || draft.command.expectedRevision !== state.revision) break;
      const choices = draft.choices.filter((c) => c.card !== el.dataset.cardid);
      if (el.dataset.symbol) choices.push({ card: el.dataset.cardid, symbol: el.dataset.symbol });
      showConvoke(draft.command, choices);
      break;
    }
    case 'confirmConvoke': {
      const draft = dialog._convokeDraft;
      if (!draft || draft.command.expectedRevision !== state.revision) break;
      const command = { ...draft.command, convoke: draft.choices };
      closeDialog();
      send(command);
      break;
    }
    case 'nextTargetGroup': {
      if (dialog._groupRevision !== state.revision) break;
      const group = dialog._groupDefinitions[dialog._groupIndex];
      const chosen = dialog._groupPlan[group.id];
      if (chosen.length < group.min || chosen.length > group.max) break;
      if (dialog._groupIndex < dialog._groupDefinitions.length - 1) {
        dialog._groupIndex++;
        showGroupedTargets();
      } else {
        const context = groupedTargetContext();
        if (!context || groupedTargetProblem(context, dialog._groupPlan)) break;
        const command = {
          ...context.command,
          targets: structuredClone(dialog._groupPlan),
          expectedRevision: dialog._groupRevision,
        };
        closeDialog();
        send(command);
      }
      break;
    }
    case 'selectTargetCard':
      if (dialog._targetRevision !== state.revision) break;
      dialog._selectedTargetIndex = Number(el.dataset.index);
      showTargetMenu();
      break;
    case 'confirmTargetChoice':
      if (dialog._selectedTargetIndex < 0) break;
      el = { dataset: { index: String(dialog._selectedTargetIndex) } };
    case 'submitTargetChoice': {
      const command = dialog._targetCommands?.[Number(el.dataset.index)];
      if (command) {
        const revision = dialog._targetRevision;
        closeDialog();
        send({ ...command, expectedRevision: revision });
      }
      break;
    }
    case 'orderTriggers':
      showTriggerOrder();
      break;
    case 'moveTrigger': {
      const ids = dialog._triggerIds,
        i = ids.indexOf(el.dataset.id),
        j = i + Number(el.dataset.direction);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      renderTriggerOrder();
      break;
    }
    case 'submitTriggers': {
      const ids = [...dialog._triggerIds];
      if (send({ type: 'orderTriggers', ids })) closeDialog();
      break;
    }
    case 'pass':
      delete ui.stops[stopKey(state, viewer())];
      ui.yieldMode = null;
      send({ type: 'pass' }, { autoPass: false });
      break;
    case 'cancelSelection':
      resetSelection();
      render();
      break;
    case 'startCrew': {
      dialog._crewDraft = { card: dialog._activationCard, cards: [], revision: state.revision };
      showCrewSelection();
      break;
    }
    case 'toggleCrew': {
      const draft = dialog._crewDraft;
      if (!draft || draft.revision !== state.revision) {
        closeDialog();
        break;
      }
      const id = el.dataset.cardid;
      if (!crewCandidates(state, viewer(), draft.card).some((o) => o.id === id)) break;
      draft.cards = draft.cards.includes(id)
        ? draft.cards.filter((x) => x !== id)
        : [...draft.cards, id];
      showCrewSelection();
      break;
    }
    case 'confirmCrew': {
      const draft = dialog._crewDraft;
      if (!draft || draft.revision !== state.revision) {
        closeDialog();
        break;
      }
      const problem = crewProblem(state, viewer(), draft.card, draft.cards);
      if (problem) {
        toast(problem);
        break;
      }
      const command = { type: 'crew', card: draft.card, cards: [...draft.cards] };
      closeDialog();
      send(command);
      break;
    }
    case 'activateAbility': {
      const id = dialog._activationCard,
        index = Number(el.dataset.ability),
        a = definition(state, state.objects[id]).activated[index];
      closeDialog();
      ui.selected = id;
      ui.activation = index;
      if (a.cost.discard) {
        const choices = legalActions(state, viewer()).filter(
          (c) => c.type === 'activate' && c.card === id && c.ability === index,
        );
        dialog._discardActions = choices;
        dialog._discardRevision = state.revision;
        const body = `<div class="decision-card-gallery ${choices.length <= 3 ? 'decision-hero' : 'decision-many'}" style="--choice-count:${choices.length}">${choices.map((c, i) => decisionCard(state, c.discardCard, metadata, { viewer: viewer(), action: 'payActivationDiscard', extra: `data-index="${i}"`, label: `Discard ${state.objects[c.discardCard].name} to activate ${state.objects[id].name}` })).join('')}</div>`;
        const reopen = () => {
          openChoiceDialog(
            'Discard a card to activate',
            `Choose the card to pay ${state.objects[id].name}'s activation cost. This card is discarded immediately.`,
            body,
            '<button class="btn" data-action="closeDialog">Cancel activation</button>',
            { source: state.objects[id].name },
          );
          dialog._stageRender = reopen;
          dialog._activeChoice = null;
        };
        reopen();
      } else if (a.targetGroups) {
        showGroupedTargets();
      } else if (a.target) {
        ui.targeting = true;
        render();
        if (
          targetsFor(state, a.target, viewer()).some(
            (target) => state.objects[target.id]?.zone === 'graveyard',
          )
        )
          showTargetMenu();
      } else send({ type: 'activate', card: id, ability: index });
      break;
    }
    case 'payActivationDiscard': {
      const command = dialog._discardActions?.[Number(el.dataset.index)];
      if (!command || state.revision !== dialog._discardRevision) {
        closeDialog();
        toast('The game changed. Choose the ability again.');
        break;
      }
      closeDialog();
      send(command);
      break;
    }
    case 'chooseX': {
      const o = state.objects[dialog._xCard?.id],
        x = Number(el.dataset.x ?? dialog.querySelector('#cast-x-value')?.value);
      if (
        !o ||
        ui.selected !== o.id ||
        o.incarnation !== dialog._xCard.incarnation ||
        state.revision !== dialog._xRevision
      ) {
        closeDialog();
        resetSelection();
        render();
        break;
      }
      if (
        !legalActions(state, viewer(), { x }).some(
          (a) => a.type === 'cast' && a.card === o.id && a.x === x,
        )
      ) {
        toast(`Choose a payable integer X from 0 to ${MAX_X} with legal targets.`);
        break;
      }
      ui.x = x;
      closeDialog();
      action('playSelected', el);
      break;
    }
    case 'spellModes':
      showSpellModes();
      break;
    case 'chooseSpellMode': {
      const saved = dialog._spellModeCard,
        mode = Number(el.dataset.mode);
      const o = state.objects[saved?.id];
      if (
        state.revision !== dialog._spellModeRevision ||
        !o ||
        o.incarnation !== saved.incarnation ||
        ui.selected !== o.id
      ) {
        toast('The game changed. Choose a mode again.');
        showSpellModes();
        break;
      }
      if (
        !legalActions(state, viewer()).some(
          (a) => a.type === 'cast' && a.card === o.id && a.mode === mode,
        )
      ) {
        toast('That mode has no legal cast right now.');
        showSpellModes();
        break;
      }
      ui.spellMode = mode;
      closeDialog();
      action('playSelected', el);
      break;
    }
    case 'turnFaceUp':
      closeDialog();
      send({ type: 'turnFaceUp', card: el.dataset.cardid });
      break;
    case 'plotSelected':
      if (ui.selected) send({ type: 'plot', card: ui.selected });
      break;
    case 'cycleSelected':
      if (ui.selected) send({ type: 'cycle', card: ui.selected });
      break;
    case 'playSelected': {
      const o = state.objects[ui.selected];
      if (!o) break;
      const printed = definition(state, o);
      if (castingChoices(printed) && ui.spellMode == null) {
        showSpellModes();
        break;
      }
      const d = spellProfile(printed, ui.spellMode ?? undefined);
      if (!d) {
        showSpellModes();
        break;
      }
      if (d.cost.X && ui.x == null) {
        showXChoice();
        break;
      }
      if (d.type === 'land') send({ type: 'playLand', card: o.id });
      else if (d.targetGroups) {
        showGroupedTargets();
      } else if (d.target) {
        ui.targeting = true;
        ui.sideTab = targetsFor(state, d.target, viewer()).some((target) => target.kind === 'stack')
          ? 'stack'
          : ui.sideTab;
        if (targetsFor(state, d.target, viewer()).some((target) => target.kind === 'stack'))
          ui.inspectorOpen = true;
        render();
        if (
          targetsFor(state, d.target, viewer()).some(
            (target) => state.objects[target.id]?.zone === 'graveyard',
          )
        )
          showTargetMenu();
      } else
        send({ type: 'cast', card: o.id, ...(castingChoices(d) ? { mode: ui.spellMode } : {}) });
      break;
    }
    case 'pause':
      ui.paused = !ui.paused;
      render();
      break;
    case 'switchSeat':
      ui.seat = ui.mode === 'bot' ? 0 : (state.choice?.player ?? state.priority);
      resetSelection();
      render();
      break;
    case 'readHandCard':
    case 'readCard': {
      const id = readableCard(state, ui, viewer());
      if (!id) break;
      cardDrag.cancel();
      showCardReader(id);
      break;
    }
    case 'inspector':
      ui.inspectorOpen = !ui.inspectorOpen;
      render();
      break;
    case 'sideTab':
      ui.sideTab = el.dataset.tab;
      render();
      break;
    case 'settings':
      showSettings();
      break;
    case 'mobileStack':
      ui.inspectorOpen = ui.sideTab !== 'stack' || !ui.inspectorOpen;
      ui.sideTab = 'stack';
      render();
      break;
    case 'tableHistory':
      ui.sideTab = 'log';
      ui.inspectorOpen = true;
      closeDialog();
      render();
      break;
    case 'tableView':
      if (!['cards', 'engine'].includes(el.dataset.view)) break;
      ui.view = el.dataset.view;
      closeDialog();
      render();
      break;
    case 'tableControl':
      if (
        !['toggleFullControl', 'yieldResponse', 'yieldTurn', 'cancelYield', 'pause'].includes(
          el.dataset.command,
        )
      )
        break;
      closeDialog();
      await action(el.dataset.command, {});
      break;
    case 'tableControls':
      openDialog(
        'Priority & passing',
        ui.mode === 'bot'
          ? `<div class="table-control-menu"><button class="btn" data-action="tableControl" data-command="toggleFullControl">${ui.controlMode === 'full' ? 'Use smart play' : 'Enable full control'}</button><button class="btn" data-action="tableControl" data-command="pause">${ui.paused ? 'Resume opponent' : 'Pause opponent'}</button>${ui.yieldMode ? '<button class="btn" data-action="tableControl" data-command="cancelYield">Stop auto-passing</button>' : '<button class="btn" data-action="tableControl" data-command="yieldResponse">Pass until response</button><button class="btn" data-action="tableControl" data-command="yieldTurn">Pass this turn</button>'}</div><p>Phase stops still interrupt passing. Full control preserves every priority window.</p><button class="btn" data-action="prioritySettings">Automation preferences</button>`
          : '<p>Local two-player mode is manual. Switch seats when the other player needs to act.</p>',
      );
      break;
    case 'tableZones':
      openDialog(
        'Public zones',
        `<div class="table-zones">${[viewer(), 1 - viewer()].map((player) => `<section><h3>${escape(state.players[player].name)}</h3><p>${state.players[player].library.length} in library · ${state.players[player].hand.length} in hand</p><button class="btn" data-action="zone" data-player="${player}" data-zone="graveyard">Graveyard · ${state.players[player].graveyard.length}</button><button class="btn" data-action="zone" data-player="${player}" data-zone="exile">Exile · ${state.players[player].exile.length}</button></section>`).join('')}</div>`,
      );
      break;
    case 'matchMenu':
      openDialog(
        'At this table',
        '<div class="table-menu"><button class="btn" data-action="tableControls">Priority & passing</button><button class="btn" data-action="phaseStops">Phase stops</button><button class="btn" data-action="tableZones">Public zones</button><button class="btn" data-action="tableHistory">Game log</button><button class="btn" data-action="settings">Table preferences</button><button class="btn" data-action="tableView" data-view="cards">Card catalog</button><button class="btn" data-action="tableView" data-view="engine">Engine & replays</button></div><p>Replays contain the full match, including hidden cards. Local saves never leave your browser.</p>',
        '<button class="btn quiet" data-action="leave">Leave table</button><button class="btn" data-action="export">Export replay</button><button class="btn danger" data-action="confirmConcede">Concede</button>',
      );
      break;
    case 'confirmConcede':
      openDialog(
        'Concede this game?',
        '<p>This ends the current match. Your opponent will win.</p>',
        '<button class="btn" data-action="closeDialog">Keep playing</button><button class="btn danger" data-action="concede">Concede game</button>',
      );
      break;
    case 'concede':
      closeDialog();
      send({ type: 'concede' });
      break;
    case 'export':
      exportMatch();
      break;
    case 'exampleModalReplay':
    case 'exampleAttackReplay':
    case 'exampleLegendReplay':
    case 'exampleSearchReplay':
    case 'exampleSacrificeReplay':
    case 'exampleBurialReplay':
    case 'exampleTargetReplay':
    case 'exampleInteractionReplay':
    case 'exampleOptionalReplay':
    case 'exampleWardReplay':
    case 'exampleReplay': {
      try {
        const response = await fetch(
          name === 'exampleModalReplay'
            ? './example-modal-replay.json'
            : name === 'exampleAttackReplay'
              ? './example-attack-replay.json'
              : name === 'exampleLegendReplay'
                ? './example-legend-replay.json'
                : name === 'exampleSearchReplay'
                  ? './example-search-replay.json'
                  : name === 'exampleSacrificeReplay'
                    ? './example-sacrifice-replay.json'
                    : name === 'exampleBurialReplay'
                      ? './example-burial-replay.json'
                      : name === 'exampleTargetReplay'
                        ? './example-target-replay.json'
                        : name === 'exampleInteractionReplay'
                          ? './example-interaction-replay.json'
                          : name === 'exampleOptionalReplay'
                            ? './example-optional-replay.json'
                            : name === 'exampleWardReplay'
                              ? './example-ward-replay.json'
                              : './example-replay.json',
        );
        if (!response.ok) throw new Error('Example replay is unavailable.');
        const record = await response.json();
        replay(record);
        ui.replayRecord = record;
        ui.replayIndex = record.commands.length;
        ui.mode = 'hotseat';
        ui.seat = 0;
        ui.view = 'play';
        replayTo(record.commands.length);
        window.scrollTo(0, 0);
      } catch (error) {
        toast(error.message);
      }
      break;
    }
    case 'loadReplay':
      document.querySelector('#replay-file').click();
      break;
    case 'takeoverReplay':
      openDialog(
        'Continue this position?',
        '<p>This creates a local branch from the current replay position. The original replay is unchanged. Both hands are available in hotseat mode.</p>',
        '<button class="btn" data-action="closeDialog">Cancel</button><button class="btn" data-action="confirmTakeover">Continue as hotseat</button><button class="btn primary" data-action="confirmTakeoverBot">Continue against bot</button>',
      );
      break;
    case 'confirmTakeoverBot':
    case 'confirmTakeover':
      ui.replayRecord = null;
      ui.mode = name === 'confirmTakeoverBot' ? 'bot' : 'hotseat';
      ui.catalog = state.catalog;
      ui.customDeck = state.config.decks[0];
      ui.seat = ui.mode === 'bot' ? 0 : (state.choice?.player ?? state.priority);
      resetSelection();
      closeDialog();
      save();
      render();
      break;
    case 'replaySeat':
      ui.seat = 1 - ui.seat;
      resetSelection();
      render();
      break;
    case 'replayNext':
      replayTo(Math.min(ui.replayIndex + 1, ui.replayRecord.commands.length));
      break;
    case 'replayBack':
      replayTo(Math.max(0, ui.replayIndex - 1));
      break;
    case 'exitReplay':
      ui.replayRecord = null;
      state = null;
      ui.view = 'play';
      render();
      break;
    case 'state':
      openDialog(
        'Local engine state',
        `<p>This developer view includes both hands and libraries. It is not a multiplayer protocol.</p><pre>${escape(JSON.stringify({ ...state, events: state.events.slice(-15), history: `${state.history.length} commands (export replay for full history)` }, null, 2))}</pre>`,
      );
      break;
    case 'zone':
      showPublicZone(Number(el.dataset.player), el.dataset.zone);
      break;
    case 'closeDialog':
      closeDialog();
      break;
  }
}
function controlledCreatures(p) {
  return Object.values(state.objects).filter(
    (o) =>
      o.zone === 'battlefield' && o.controller === p && definition(state, o).type === 'creature',
  );
}
const cardDrag = installCardDrag(app, {
  inspect: showCardReader,
  begin(id) {
    if (ui.replayRecord || ui.view !== 'play' || dialog.open) return null;
    const player = viewer(),
      plan = cardDropPlan(state, player, id);
    if (!plan) return null;
    clearTimeout(botTimer);
    const object = state.objects[id],
      zones = [];
    for (const destination of plan.destinations) {
      const target = destination.target;
      const selector = !target
        ? `[data-field="${destination.field}"]`
        : target.kind === 'player'
          ? `.player-band[data-player="${target.id}"]`
          : target.kind === 'stack'
            ? `[data-stack="${CSS.escape(target.id)}"]`
            : `[data-card="${CSS.escape(target.id)}"]`;
      const graveyard = target?.kind === 'object' && state.objects[target.id]?.zone === 'graveyard';
      const element =
        app.querySelector(selector) ??
        (graveyard
          ? app.querySelector(
              `[data-zone="graveyard"][data-player="${state.objects[target.id].owner}"]`,
            )
          : null);
      if (!element) continue;
      const label = ['chooseMode', 'chooseX'].includes(plan.kind)
        ? `Release to choose ${plan.kind === 'chooseX' ? 'X' : 'a mode'} for ${object.name}`
        : plan.kind === 'attack'
          ? `Release to select ${object.name} as an attacker`
          : plan.kind === 'block'
            ? `Release to assign ${object.name} as a blocker`
            : target
              ? `Release to target ${element.getAttribute('aria-label') ?? element.textContent.trim()}`
              : `Release to ${destination.type === 'playLand' ? 'play' : 'cast'} ${object.name}`;
      zones.push({
        element,
        command: destination,
        label: graveyard ? `Release to target ${state.objects[target.id].name}` : label,
        proxyOnly: graveyard,
        trayLabel: graveyard ? state.objects[target.id].name : null,
        stackLabel:
          target?.kind === 'stack'
            ? state.stack.find((entry) => entry.id === target.id)?.name
            : null,
      });
    }
    if (plan.kind === 'play' && plan.destinations.some((d) => d.target)) {
      for (const player of [viewer(), 1 - viewer()]) {
        const field = app.querySelector(`[data-field="${player}"]`);
        if (field)
          zones.push({
            element: field,
            intent: true,
            label: `Release to choose a target for ${object.name}`,
          });
      }
    }
    return {
      revision: state.revision,
      kind: plan.kind,
      targeted: !!plan.destinations[0]?.target,
      zones,
      label: !zones.length
        ? 'No legal drop available · release to return'
        : plan.kind === 'attack'
          ? 'Drag toward your opponent · confirm attackers afterward'
          : plan.kind === 'block'
            ? 'Drag onto an attacker · confirm blockers afterward'
            : plan.destinations[0]?.target
              ? 'Drag onto a highlighted target · Esc to cancel'
              : 'Drag onto your battlefield · Esc to cancel',
    };
  },
  commit(gesture, zone) {
    if (state.revision !== gesture.revision) {
      toast('The game changed while you were dragging. Pick the card up again.');
      return false;
    }
    if (['chooseMode', 'chooseX'].includes(gesture.kind)) {
      resetSelection();
      ui.selected = gesture.id;
      if (gesture.kind === 'chooseX') showXChoice();
      else showSpellModes();
      return true;
    }
    if (zone.intent) {
      ui.selected = gesture.id;
      ui.activation = null;
      ui.targeting = true;
      render();
      return true;
    }
    if (gesture.kind === 'attack') {
      ui.chosen = ui.chosen.includes(gesture.id) ? ui.chosen : [...ui.chosen, gesture.id];
      render();
      return true;
    }
    if (gesture.kind === 'block') {
      ui.blocks = [
        ...ui.blocks.filter((pair) => pair.blocker !== gesture.id),
        { blocker: gesture.id, attacker: zone.command.target.id },
      ];
      ui.selected = null;
      render();
      return true;
    }
    dragMotionCard = gesture.id;
    try {
      const { field, ...command } = zone.command;
      return send({ ...command, expectedRevision: gesture.revision });
    } finally {
      dragMotionCard = null;
    }
  },
  end: schedule,
  feedback: toast,
});
function selectCard(id) {
  const o = state?.objects[id];
  if (!o) return;
  ui.inspect = o.name;
  ui.inspectObject = id;
  if (ui.replayRecord) {
    render();
    return;
  }
  const p = viewer(),
    c = state.choice;
  if ((c?.player ?? state.priority) !== p) {
    render();
    return;
  }
  if (c?.kind === 'triggerTarget') {
    send({ type: 'chooseTriggerTarget', target: ref(o) });
    return;
  }
  if (ui.targeting) {
    if (
      targetsFor(
        state,
        ui.activation !== null
          ? definition(state, state.objects[ui.selected]).activated[ui.activation].target
          : spellProfile(definition(state, state.objects[ui.selected]), ui.spellMode ?? undefined)
              ?.target,
        p,
      ).some((t) => t.kind === 'object' && t.id === id)
    )
      send({
        type: ui.activation !== null ? 'activate' : 'cast',
        card: ui.selected,
        ...(ui.activation !== null
          ? { ability: ui.activation }
          : ui.spellMode != null
            ? { mode: ui.spellMode }
            : {}),
        target: ref(o),
      });
    else toast('That is not a legal target.');
    return;
  }
  if (c?.kind === 'bottom' || c?.kind === 'discard' || c?.kind === 'discardEffect') {
    if (!state.players[p].hand.includes(id)) return;
    ui.chosen = ui.chosen.includes(id) ? ui.chosen.filter((x) => x !== id) : [...ui.chosen, id];
    render();
    return;
  }
  if (c?.kind === 'attackers') {
    if (!canAttack(state, o, p)) {
      toast('That creature cannot attack.');
      return;
    }
    ui.chosen = ui.chosen.includes(id) ? ui.chosen.filter((x) => x !== id) : [...ui.chosen, id];
    render();
    return;
  }
  if (c?.kind === 'blockers') {
    if (
      o.controller === p &&
      o.zone === 'battlefield' &&
      definition(state, o).type === 'creature'
    ) {
      const paired = ui.blocks.find((b) => b.blocker === id);
      if (paired) {
        ui.blocks = ui.blocks.filter((b) => b.blocker !== id);
        ui.selected = null;
      } else ui.selected = ui.selected === id ? null : id;
    } else if (ui.selected && state.combat.attackers.some((r) => r.id === id)) {
      if (canBlock(state, state.objects[ui.selected], o, p)) {
        ui.blocks.push({ blocker: ui.selected, attacker: id });
        ui.selected = null;
      } else toast('That block is not legal.');
    }
    render();
    return;
  }
  if (!c && playableZone(state, o, p)) {
    const again = ui.lastHandClick?.id === id && performance.now() - ui.lastHandClick.time < 450;
    ui.lastHandClick = { id, time: performance.now() };
    if (
      again &&
      !definition(state, o).target &&
      legalActions(state, p).some((a) => a.card === id && ['playLand', 'cast'].includes(a.type))
    ) {
      ui.selected = id;
      ui.activation = null;
      action('playSelected', {});
      return;
    }
    ui.spellMode = null;
    ui.x = null;
    ui.selected = ui.selected === id ? null : id;
    if (
      ui.selected &&
      definition(state, o).target &&
      legalActions(state, p).some((a) => a.type === 'cast' && a.card === id)
    ) {
      ui.targeting = true;
      ui.activation = null;
    }
    render();
    return;
  }
  if (!c && o.zone === 'battlefield' && o.controller === p && o.faceDown) {
    const allowed = legalActions(state, p).some((a) => a.type === 'turnFaceUp' && a.card === id);
    openDialog(
      'Turn face up',
      '<p>This is a special action, not an activated ability. Pay the disguise cost to reveal it without using the stack.</p>',
      `<button class="btn primary" data-action="turnFaceUp" data-cardid="${id}" ${allowed ? '' : 'disabled'}>Turn face up</button><button class="btn" data-action="closeDialog">Cancel</button>`,
    );
    return;
  }
  if (
    !c &&
    o.zone === 'battlefield' &&
    o.controller === p &&
    (definition(state, o).activated?.length || definition(state, o).crew !== undefined)
  ) {
    const abilities = definition(state, o).activated ?? [],
      legal = legalActions(state, p);
    const manaButtons = definition(state, o).mana
      ? manaOptions(state, o)
          .map(
            (color) =>
              `<button class="btn" data-action="chooseMana" data-color="${color}" ${canTapForMana(state, o, p) ? '' : 'disabled'}>${mana({ [color]: 1 })} Tap: add ${color}</button>`,
          )
          .join('')
      : '';
    openDialog(
      o.name,
      `<p style="margin-bottom:16px">Mana abilities resolve immediately. Other abilities use the stack. Costs are paid when you activate, not when the ability resolves.</p>`,
      manaButtons +
        (definition(state, o).crew !== undefined
          ? `<button class="btn primary" data-action="startCrew" ${legal.some((a) => a.type === 'crew' && a.card === id) ? '' : 'disabled'}>Crew ${definition(state, o).crew}</button>`
          : '') +
        abilities
          .map(
            (a, i) =>
              `<button class="btn primary" data-action="activateAbility" data-ability="${i}" ${legal.some((x) => x.type === 'activate' && x.card === id && x.ability === i) ? '' : 'disabled'}>${a.cost.sacrificeSelf ? `<span>⚑ Sacrifice ${escape(o.name)} · </span>` : ''}${escape((a.text ?? 'Activate ability').replaceAll('CARDNAME', o.name))}</button>`,
          )
          .join('') +
        '<button class="btn" data-action="closeDialog">Cancel</button>',
    );
    dialog._activationCard = id;
    dialog._manaCard = id;
    return;
  }
  if (!c && canTapForMana(state, o, p)) {
    const options = manaOptions(state, o);
    if (options.length > 1) {
      openDialog(
        'Choose mana',
        `<p>${escape(o.name)} can produce one of these colors.</p>`,
        options
          .map(
            (color) =>
              `<button class="btn primary" data-action="chooseMana" data-color="${color}">${mana({ [color]: 1 })} Add ${color}</button>`,
          )
          .join('') + '<button class="btn" data-action="closeDialog">Cancel</button>',
      );
      dialog._manaCard = id;
    } else send({ type: 'tapMana', card: id }, { autoPass: false });
    return;
  }
  render();
}
document.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    action(actionEl.dataset.action, actionEl);
    return;
  }
  const card = e.target.closest('[data-card]');
  if (card) {
    selectCard(card.dataset.card);
    return;
  }
  const catalogCard = e.target.closest('[data-inspect]');
  if (catalogCard) {
    openDialog(catalogCard.dataset.inspect, inspect(catalogCard.dataset.inspect, metadata));
    return;
  }
  if (state && (ui.targeting || state.choice?.kind === 'triggerTarget')) {
    const player = e.target.closest('[data-player]'),
      stack = e.target.closest('[data-stack]');
    let target = null;
    if (player) target = { kind: 'player', id: Number(player.dataset.player) };
    if (stack) target = { kind: 'stack', id: stack.dataset.stack };
    if (target && state.choice?.kind === 'triggerTarget') {
      send({ type: 'chooseTriggerTarget', target });
      return;
    }
    if (target)
      send({
        type: ui.activation !== null ? 'activate' : 'cast',
        card: ui.selected,
        ...(ui.activation !== null
          ? { ability: ui.activation }
          : ui.spellMode != null
            ? { mode: ui.spellMode }
            : {}),
        target,
      });
  }
});
app.addEventListener('dblclick', (e) => {
  const card = e.target.closest('.hand-card[data-card]');
  if (!card || !state || ui.replayRecord) return;
  const id = card.dataset.card,
    o = state.objects[id];
  if (!o || o.owner !== viewer() || state.choice) return;
  const legal = legalActions(state, viewer()).find(
    (a) => a.card === id && ['playLand', 'cast'].includes(a.type),
  );
  if (!legal) return;
  ui.selected = id;
  ui.activation = null;
  ui.spellMode = null;
  ui.x = null;
  action('playSelected', card);
});
app.addEventListener(
  'error',
  (event) => {
    const image = event.target;
    if (image.tagName !== 'IMG') return;
    const card = image.closest('[data-card]'),
      object = state?.objects[card?.dataset.card];
    if (!object || card.querySelector('.image-fallback')) return;
    image.hidden = true;
    const d = definition(state, object),
      fallback = document.createElement('div');
    fallback.className = 'image-fallback';
    fallback.innerHTML = `<strong>${escape(object.name)}</strong>${mana(d.cost)}<p>${escape(d.text)}</p><small>Card image unavailable</small>`;
    card.append(fallback);
  },
  true,
);
app.addEventListener('pointerover', (e) => {
  if (cardDrag.active) return;
  const el = e.target.closest('[data-card]');
  if (!el || !state) return;
  const name = state.objects[el.dataset.card]?.name;
  if (!name || (ui.inspect === name && ui.inspectObject === el.dataset.card)) return;
  ui.inspectObject = el.dataset.card;
  ui.inspect = name;
  const detail = document.querySelector('#inspect-detail');
  if (detail) detail.innerHTML = inspect(name, metadata, state, ui.inspectObject, viewer());
});
document.addEventListener('change', (e) => {
  switch (e.target.id) {
    case 'opponent-deck':
      ui.opponentDeck = e.target.value;
      render();
      break;
    case 'builder-color':
      ui.builderColor = e.target.value;
      render();
      break;
    case 'builder-type':
      ui.builderType = e.target.value;
      render();
      break;
    case 'auto-order-triggers':
      ui.autoOrderTriggers = e.target.checked;
      break;
    case 'auto-damage':
      ui.autoDamage = e.target.checked;
      break;
    case 'mode':
      ui.mode = e.target.value;
      break;
    case 'seed':
      ui.seed = Number(e.target.value);
      break;
    case 'auto-yield':
      ui.autoYield = e.target.checked;
      save();
      schedule();
      break;
    case 'reduce-motion':
      ui.reduceMotion = e.target.checked;
      document.documentElement.dataset.motion = ui.reduceMotion ? 'reduced' : 'system';
      try {
        localStorage.setItem('leyline.reduce-motion', String(ui.reduceMotion));
      } catch {}
      break;
    case 'hold-priority':
      ui.holdPriority = e.target.checked;
      save();
      break;
    case 'card-filter':
      ui.filter = e.target.value;
      render();
      break;
  }
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'deck-name') {
    ui.deckDraft.name = e.target.value;
    preserveDraft();
    return;
  }
  if (['deck-search', 'builder-search'].includes(e.target.id)) {
    const id = e.target.id,
      pos = e.target.selectionStart;
    ui[id === 'deck-search' ? 'deckQuery' : 'builderQuery'] = e.target.value;
    render();
    const input = document.getElementById(id);
    input.focus();
    input.setSelectionRange(pos, pos);
    return;
  }

  if (e.target.id === 'replay-position') {
    replayTo(Number(e.target.value));
    return;
  }
  if (e.target.id === 'card-search') {
    const pos = e.target.selectionStart;
    ui.query = e.target.value;
    render();
    const input = document.querySelector('#card-search');
    input.focus();
    try {
      input.setSelectionRange(pos, pos);
    } catch {}
  }
});
app.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.builder-card');
  if (!card || card.disabled) return;
  e.dataTransfer.setData('text/plain', card.dataset.name);
  e.dataTransfer.effectAllowed = 'copy';
  app.querySelector('[data-deck-drop]')?.classList.add('accepting-card');
});
app.addEventListener('dragover', (e) => {
  if (e.target.closest('[data-deck-drop]')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
app.addEventListener('drop', (e) => {
  if (!e.target.closest('[data-deck-drop]')) return;
  e.preventDefault();
  action('addDraftCard', { dataset: { name: e.dataTransfer.getData('text/plain') } });
});
app.addEventListener('dragend', () =>
  app.querySelector('[data-deck-drop]')?.classList.remove('accepting-card'),
);
document.addEventListener('keydown', (e) => {
  const shortcut = duelShortcut(
    {
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      targetTag: e.target.tagName,
      editable: e.target.isContentEditable,
      focusedCard: e.target.closest('.hand-card')?.dataset.card,
    },
    {
      dialogOpen: dialog.open,
      hasState: !!state,
      view: ui.view,
      replay: !!ui.replayRecord,
      selected: ui.selected,
      targeting: ui.targeting,
      hasChoice: !!state?.choice,
      hasPriority: state?.priority === viewer(),
    },
  );
  if (!shortcut) return;
  e.preventDefault();
  if (shortcut === 'cancelSelection') {
    ui.yieldMode = null;
    duelPresentation.hidePreview();
  }
  action(shortcut, {});
});
document.querySelector('#replay-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('Replay exceeds 5 MB.');
    const record = JSON.parse(await file.text());
    if (!Array.isArray(record.commands) || record.commands.length > 5000)
      throw new Error(
        'Browser replay limit is 5,000 commands. Use the Node engine for larger logs.',
      );
    replay(record);
    ui.replayRecord = record;
    ui.replayIndex = 0;
    ui.mode = 'hotseat';
    ui.seat = 0;
    ui.view = 'play';
    replayTo(0);
  } catch (err) {
    toast(`Could not load replay: ${err.message}`);
  }
  e.target.value = '';
});
render();
