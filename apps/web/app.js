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
  ui.selected = null;
  ui.targeting = false;
  ui.activation = null;
  ui.spellMode = null;
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
  const c = { player: viewer(), expectedRevision: state.revision, ...command };
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
function openDialog(title, body, actions = '') {
  clearTimeout(botTimer);
  duelPresentation.hidePreview();
  dialog.innerHTML = `<div class="dialog-head"><h2>${escape(title)}</h2><button class="icon-btn" data-action="closeDialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${body}</div><div class="dialog-actions">${actions || '<button class="btn" data-action="closeDialog">Done</button>'}</div>`;
  if (!dialog.open) dialog.showModal();
}
function showCardReader(id) {
  const object = inspectableCard(state, id, viewer());
  if (!object) return false;
  ui.inspect = object.name;
  ui.inspectObject = id;
  openDialog(object.name, inspect(object.name, metadata, state, id));
  return true;
}
function closeDialog() {
  dialog.close();
  schedule();
}
dialog.addEventListener('close', () => {
  duelPresentation.hidePreview();
  schedule();
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
function showSpellModes() {
  const o = state?.objects[ui.selected];
  if (!o || o.zone !== 'hand' || o.owner !== viewer() || !definition(state, o).modes) return;
  ui.spellMode = null;
  ui.targeting = false;
  render();
  openDialog(
    `Choose a mode: ${o.name}`,
    spellModeBody(state, viewer(), o.id),
    '<button class="btn quiet" data-action="closeDialog">Cancel</button>',
  );
  dialog._spellModeCard = ref(o);
  dialog._spellModeRevision = state.revision;
}
function showLegendChoice() {
  const c = state.choice;
  if (c?.kind !== 'legendRule' || c.player !== viewer()) return;
  openDialog(
    'Legend rule: choose one to keep',
    legendChoiceBody(state, metadata),
    '<button class="btn quiet" data-action="closeDialog">Review table</button>',
  );
  dialog._legendChoice = c;
}
function showLibrarySearch() {
  const choice = state.choice;
  if (choice?.kind !== 'librarySearch' || choice.player !== viewer()) return;
  if (dialog._searchChoice !== choice) {
    dialog._searchChoice = choice;
    dialog._searchCards = [];
  }
  const selected = dialog._searchCards;
  const groups = new Map();
  for (const id of choice.cards) {
    const name = state.objects[id].name;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(id);
  }
  const chosen = selected
    .map(
      (id, index) =>
        `<div class="search-picked"><span>${choice.destination === 'top' ? `${index + 1}. ` : ''}${escape(state.objects[id].name)}</span>${choice.destination === 'top' ? `<button class="icon-btn" data-action="searchReorder" data-index="${index}" data-direction="-1" aria-label="Move earlier" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn" data-action="searchReorder" data-index="${index}" data-direction="1" aria-label="Move later" ${index === selected.length - 1 ? 'disabled' : ''}>↓</button>` : ''}<button class="icon-btn" data-action="searchRemove" data-cardid="${id}" aria-label="Remove ${escape(state.objects[id].name)}">×</button></div>`,
    )
    .join('');
  const body = `<p>${choice.min === 0 ? 'You may find fewer cards, including none.' : `Choose exactly ${choice.min} card${choice.min === 1 ? '' : 's'}.`} Your library is shuffled when you confirm. ${choice.destination === 'top' ? 'Selected cards go on top afterward, first card drawn first.' : `Found cards go to ${choice.destination === 'hand' ? 'your hand' : choice.destination === 'graveyard' ? 'your graveyard' : `the battlefield${choice.tapped ? ' tapped' : ''}`}.`}</p><div class="search-picked-list">${chosen || '<p>No cards selected.</p>'}</div><div class="search-options">${
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ids]) => {
        const used = ids.filter((id) => selected.includes(id)).length;
        return `<div class="library-choice"><div class="library-thumb">${metadata[name]?.image ? `<img src="${escape(metadata[name].image)}" alt="" loading="lazy">` : '◇'}</div><div class="library-choice-body"><strong>${escape(name)}</strong><span class="small muted">${ids.length} available · ${used} selected</span><div class="library-choice-actions"><button class="btn" data-action="searchAdd" data-name="${escape(name)}" ${selected.length >= choice.max || used === ids.length ? 'disabled' : ''}>Choose</button><button class="btn quiet" data-action="readSearchCard" data-name="${escape(name)}">Read</button></div></div></div>`;
      })
      .join('') || '<p>No matching cards remain.</p>'
  }</div>`;
  openDialog(
    `Search · ${selected.length}/${choice.max} selected`,
    body,
    `<button class="btn quiet" data-action="closeDialog">Review table</button><button class="btn primary" data-action="confirmSearch" ${selected.length < choice.min ? 'disabled' : ''}>${selected.length ? 'Find cards & shuffle' : 'Find none & shuffle'}</button>`,
  );
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
    choice = state.choice,
    restLabel = choice.action === 'scry' ? 'Bottom of library' : 'Graveyard';
  const groups = [
    ['top', 'Top of library'],
    ['rest', restLabel],
  ];
  const body = `<p>The first card in the top group will be drawn first. Move cards between groups and choose their order.</p>${groups
    .map(
      ([key, label]) =>
        `<h3 style="margin:20px 0 10px">${label}</h3><div class="library-group">${
          order[key]
            .map((id, i) => {
              const o = state.objects[id];
              return `<div class="library-choice"><div class="library-thumb">${metadata[o.name]?.image ? `<img src="${escape(metadata[o.name].image)}" alt="${escape(o.name)}">` : '◇'}</div><div class="library-choice-body"><strong>${escape(o.name)}</strong><span class="small muted">Position ${i + 1}</span><div class="library-choice-actions"><button class="btn small" data-action="libraryMove" data-cardid="${id}" data-group="${key === 'top' ? 'rest' : 'top'}">${key === 'top' ? restLabel : 'Keep on top'}</button><button class="icon-btn" data-action="libraryReorder" data-group="${key}" data-index="${i}" data-direction="-1" aria-label="Move ${escape(o.name)} earlier" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn" data-action="libraryReorder" data-group="${key}" data-index="${i}" data-direction="1" aria-label="Move ${escape(o.name)} later" ${i === order[key].length - 1 ? 'disabled' : ''}>↓</button></div></div></div>`;
            })
            .join('') || '<p class="muted">No cards here.</p>'
        }</div>`,
    )
    .join('')}`;
  openDialog(
    choice.action === 'scry' ? 'Scry' : 'Surveil',
    body,
    '<button class="btn quiet" data-action="closeDialog">Review table</button><button class="btn primary" data-action="submitLibrary">Confirm arrangement</button>',
  );
  dialog._libraryOrder = order;
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
function showSettings() {
  openDialog(
    'Table preferences',
    `<div class="options-row"><label class="toggle"><input type="checkbox" id="auto-yield" ${ui.autoYield ? 'checked' : ''}>Yield when no response is available</label><label class="toggle"><input type="checkbox" id="hold-priority" ${ui.holdPriority ? 'checked' : ''}>Hold priority after casting</label><label class="toggle"><input type="checkbox" id="reduce-motion" ${ui.reduceMotion ? 'checked' : ''}>Reduce motion</label></div><p class="small muted">System reduced-motion preferences are always respected.</p><p style="margin-top:22px">Automatic yielding stops whenever you can cast a spell. Disable it to inspect every priority window. Mana sources are paid automatically when casting, or click a land to float mana manually.</p><p style="margin-top:12px">Drag a card onto your field to play, or onto a highlighted target to cast. Drag creatures toward your opponent to select attackers, or onto an attacker to assign a blocker, then confirm the group. Keyboard: Space passes priority. Escape cancels a drag or card selection. All match controls are reachable with Tab.</p>`,
  );
}
function showTargetMenu() {
  const choice = state.choice;
  const commands =
    choice?.kind === 'triggerTarget'
      ? choice.targets.map((target) => ({ type: 'chooseTriggerTarget', target }))
      : legalActions(state, viewer()).filter(
          (command) =>
            command.card === ui.selected &&
            command.target &&
            command.type === (ui.activation === null ? 'cast' : 'activate') &&
            (ui.activation === null
              ? command.mode === (ui.spellMode ?? undefined)
              : command.ability === ui.activation),
        );
  const name =
    choice?.kind === 'triggerTarget' ? choice.entry.name : state.objects[ui.selected]?.name;
  openDialog(
    `Target for ${name}`,
    `<p>Choose a legal target. The spell or ability will still use the stack.</p><div class="target-grid">${
      commands
        .map((command, index) => {
          const target = command.target,
            object = target.kind === 'object' ? state.objects[target.id] : null;
          const label =
            object?.name ??
            (target.kind === 'player'
              ? state.players[target.id].name
              : state.stack.find((entry) => entry.id === target.id)?.name);
          const detail = object
            ? `${object.zone} · ${state.players[object.owner].name}`
            : target.kind;
          return `<button class="btn target-option" data-action="submitTargetChoice" data-index="${index}"><strong>${escape(label)}</strong><span>${escape(detail)}</span></button>`;
        })
        .join('') || '<p>No legal targets remain.</p>'
    }</div>`,
    '<button class="btn" data-action="closeDialog">Back to table</button>',
  );
  dialog._targetCommands = commands;
  dialog._targetRevision = state.revision;
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
        ui.deck = DECKS[saved.deck] ? saved.deck : 'ember';
        ui.customDeck =
          saved.customDeck ??
          (JSON.stringify(state.config.decks[0]) ===
          JSON.stringify(expandDeck(DECKS[ui.deck].cards))
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
      if (send({ type: 'searchLibrary', cards: [...dialog._searchCards] })) closeDialog();
      break;
    case 'libraryOrder':
      showLibraryOrder();
      break;
    case 'libraryMove': {
      const order = dialog._libraryOrder,
        id = el.dataset.cardid;
      order.top = order.top.filter((x) => x !== id);
      order.rest = order.rest.filter((x) => x !== id);
      order[el.dataset.group].push(id);
      renderLibraryOrder();
      break;
    }
    case 'libraryReorder': {
      const group = dialog._libraryOrder[el.dataset.group],
        i = Number(el.dataset.index),
        j = i + Number(el.dataset.direction);
      [group[i], group[j]] = [group[j], group[i]];
      renderLibraryOrder();
      break;
    }
    case 'submitLibrary': {
      const order = structuredClone(dialog._libraryOrder);
      if (send({ type: 'orderLibrary', ...order })) closeDialog();
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
    case 'submitTargetChoice': {
      const command = dialog._targetCommands?.[Number(el.dataset.index)];
      if (command && send({ ...command, expectedRevision: dialog._targetRevision })) closeDialog();
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
    case 'activateAbility': {
      const id = dialog._activationCard,
        index = Number(el.dataset.ability),
        a = definition(state, state.objects[id]).activated[index];
      closeDialog();
      ui.selected = id;
      ui.activation = index;
      if (a.target) {
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
    case 'cycleSelected':
      if (ui.selected) send({ type: 'cycle', card: ui.selected });
      break;
    case 'playSelected': {
      const o = state.objects[ui.selected];
      if (!o) break;
      const printed = definition(state, o);
      if (printed.modes && ui.spellMode == null) {
        showSpellModes();
        break;
      }
      const d = spellProfile(printed, ui.spellMode ?? undefined);
      if (!d) {
        showSpellModes();
        break;
      }
      if (d.type === 'land') send({ type: 'playLand', card: o.id });
      else if (d.target) {
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
      } else send({ type: 'cast', card: o.id, ...(d.modes ? { mode: ui.spellMode } : {}) });
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
    case 'zone': {
      const p = Number(el.dataset.player),
        z = el.dataset.zone;
      openDialog(
        `${state.players[p].name} · ${z}`,
        `<div class="zone-grid">${
          state.players[p][z]
            .map((id) => {
              const o = state.objects[id];
              return `<div>${metadata[o.name]?.image ? `<img src="${escape(metadata[o.name].image)}" alt="${escape(o.name)}">` : ''}<p>${escape(o.name)}</p></div>`;
            })
            .join('') || '<p>This zone is empty.</p>'
        }</div>`,
      );
      break;
    }
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
      const label =
        plan.kind === 'chooseMode'
          ? `Release to choose a mode for ${object.name}`
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
    if (gesture.kind === 'chooseMode') {
      resetSelection();
      ui.selected = gesture.id;
      showSpellModes();
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
  if (!c && o.zone === 'hand' && o.owner === p) {
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
  if (
    !c &&
    o.zone === 'battlefield' &&
    o.controller === p &&
    definition(state, o).activated?.length
  ) {
    const abilities = definition(state, o).activated,
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
  if (detail) detail.innerHTML = inspect(name, metadata, state, ui.inspectObject);
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
