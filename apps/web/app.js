import {
  CARDS,
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
  ref,
  suggestedDamage,
  targetsFor,
} from '../../packages/engine/src/index.js';
import {
  escape,
  header,
  lobby,
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
  deck: 'ember',
  mode: 'bot',
  seed: 731,
  autoYield: true,
  holdPriority: false,
  saved: !!readSave(),
  selected: null,
  targeting: false,
  activation: null,
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
const viewer = () => (ui.mode === 'hotseat' ? ui.seat : 0);
function toast(text) {
  const el = document.querySelector('#toast');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}
function render() {
  app.innerHTML = `<div class="shell">${header(ui)}${ui.view === 'cards' ? catalog(ui, metadata) : ui.view === 'engine' ? enginePage(state) : state ? game(state, ui, metadata) : lobby(ui, metadata)}</div>`;
  schedule();
}
function resetSelection() {
  ui.selected = null;
  ui.targeting = false;
  ui.activation = null;
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
        autoYield: ui.autoYield,
        holdPriority: ui.holdPriority,
      }),
    );
    ui.saved = true;
  } catch {
    toast('Local storage is full or unavailable. Export a replay to save this match.');
  }
}
function send(command, { autoPass = true } = {}) {
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
  state = result.state;
  resetSelection();
  save();
  if (
    autoPass &&
    !ui.holdPriority &&
    ['cast', 'activate'].includes(c.type) &&
    state.priority === c.player &&
    !state.choice &&
    state.status === 'playing'
  ) {
    const passed = dispatch(state, {
      type: 'pass',
      player: c.player,
      expectedRevision: state.revision,
    });
    if (passed.ok) state = passed.state;
  }
  save();
  render();
  return true;
}
function schedule() {
  clearTimeout(botTimer);
  if (
    !state ||
    ui.view !== 'play' ||
    ui.paused ||
    ui.replayRecord ||
    dialog.open ||
    state.status === 'finished' ||
    ui.mode !== 'bot'
  )
    return;
  const actor = state.choice?.player ?? state.priority;
  if (actor === 1) {
    const revision = state.revision;
    botTimer = setTimeout(() => {
      if (state.revision !== revision) return;
      const cmd = chooseBotCommand(state, 1);
      if (cmd) send(cmd, { autoPass: false });
    }, 650);
    return;
  }
  if (!state.choice && ui.autoYield && !ui.targeting && !ui.selected) {
    const actions = legalActions(state, 0);
    const useful = actions.some((a) => ['cast', 'activate', 'playLand'].includes(a.type));
    if (!useful && (state.active !== 0 || !['main1', 'main2'].includes(state.step))) {
      const revision = state.revision;
      botTimer = setTimeout(() => {
        if (state.revision === revision) send({ type: 'pass' }, { autoPass: false });
      }, 450);
    }
  }
}
function openDialog(title, body, actions = '') {
  clearTimeout(botTimer);
  dialog.innerHTML = `<div class="dialog-head"><h2>${escape(title)}</h2><button class="icon-btn" data-action="closeDialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${body}</div><div class="dialog-actions">${actions || '<button class="btn" data-action="closeDialog">Done</button>'}</div>`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  dialog.close();
  schedule();
}
dialog.addEventListener('close', schedule);
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      closeDialog();
  }
});
function start() {
  clearTimeout(botTimer);
  ui.replayRecord = null;
  ui.seat = 0;
  ui.paused = false;
  resetSelection();
  try {
    state = createGame({
      decks: [
        ui.customDeck ?? expandDeck(DECKS[ui.deck].cards),
        expandDeck(DECKS[ui.deck === 'ember' ? 'grove' : 'ember'].cards),
      ],
      seed: ui.seed,
      names:
        ui.mode === 'hotseat'
          ? ['Player one', 'Player two']
          : ['You', ui.deck === 'ember' ? 'Grovekeeper' : 'Embermage'],
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
  if (!state) {
    toast('Start a match first.');
    return;
  }
  const blob = new Blob([JSON.stringify(exportReplay(state), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leyline-${state.seed}-turn-${state.turn}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Replay exported. It contains both players’ full decks and hidden cards.');
}
function showDeck() {
  const list = ui.customDeck
    ? ui.customDeck.reduce((a, n) => ((a[n] = (a[n] ?? 0) + 1), a), {})
    : DECKS[ui.deck].cards;
  openDialog(
    ui.customDeck ? 'Your imported deck' : DECKS[ui.deck].name,
    `<p style="margin-bottom:16px">${Object.values(list).reduce((a, b) => a + b, 0)} cards · supported local constructed pool</p>${Object.entries(
      list,
    )
      .map(
        ([n, c]) =>
          `<div class="rule-row"><span>${c} × ${escape(n)}</span>${mana(CARDS[n].cost)}</div>`,
      )
      .join('')}`,
  );
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
    `<div class="options-row"><label class="toggle"><input type="checkbox" id="auto-yield" ${ui.autoYield ? 'checked' : ''}>Yield when no response is available</label><label class="toggle"><input type="checkbox" id="hold-priority" ${ui.holdPriority ? 'checked' : ''}>Hold priority after casting</label></div><p style="margin-top:22px">Automatic yielding stops whenever you can cast a spell. Disable it to inspect every priority window. Mana sources are paid automatically when casting, or click a land to float mana manually.</p><p style="margin-top:12px">Keyboard: Space passes priority. Escape cancels card selection. All match controls are reachable with Tab.</p>`,
  );
}
async function action(name, el) {
  switch (name) {
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
      ui.customDeck = null;
      render();
      break;
    case 'start':
      start();
      break;
    case 'resume':
      try {
        const saved = JSON.parse(readSave());
        state = replay(saved.replay);
        ui.mode = saved.mode;
        ui.deck = saved.deck;
        ui.autoYield = saved.autoYield ?? true;
        ui.holdPriority = saved.holdPriority ?? false;
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
        '<button class="btn" data-action="closeDialog">Cancel</button><button class="btn primary" data-action="validateDeck">Validate & use deck</button>',
      );
      break;
    case 'validateDeck': {
      const result = parseDeck(document.querySelector('#deck-input').value);
      if (result.errors.length) {
        document.querySelector('#deck-errors').textContent = result.errors.join('\n');
        break;
      }
      ui.customDeck = result.names;
      closeDialog();
      if (state) {
        toast('Deck imported for your next match. Current match is unchanged.');
      } else render();
      break;
    }
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
      send({ type: 'pass' }, { autoPass: false });
      break;
    case 'cancelSelection':
      resetSelection();
      render();
      break;
    case 'activateAbility': {
      const id = dialog._activationCard,
        index = Number(el.dataset.ability),
        a = CARDS[state.objects[id].name].activated[index];
      closeDialog();
      ui.selected = id;
      ui.activation = index;
      if (a.target) {
        ui.targeting = true;
        render();
      } else send({ type: 'activate', card: id, ability: index });
      break;
    }
    case 'playSelected': {
      const o = state.objects[ui.selected],
        d = CARDS[o.name];
      if (d.type === 'land') send({ type: 'playLand', card: o.id });
      else if (d.target) {
        ui.targeting = true;
        ui.sideTab = d.target.includes('Spell') || d.target === 'spell' ? 'stack' : ui.sideTab;
        render();
      } else send({ type: 'cast', card: o.id });
      break;
    }
    case 'pause':
      ui.paused = !ui.paused;
      render();
      break;
    case 'switchSeat':
      ui.seat = state.choice?.player ?? state.priority;
      resetSelection();
      render();
      break;
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
    case 'matchMenu':
      openDialog(
        'At this table',
        '<p>Replays contain the full match, including hidden cards. Local saves never leave your browser.</p>',
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
    case 'exampleReplay': {
      try {
        const response = await fetch('./example-replay.json');
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
    (o) => o.zone === 'battlefield' && o.controller === p && CARDS[o.name].type === 'creature',
  );
}
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
  if (ui.targeting) {
    if (
      targetsFor(
        state,
        ui.activation !== null
          ? CARDS[state.objects[ui.selected].name].activated[ui.activation].target
          : CARDS[state.objects[ui.selected].name].target,
        p,
      ).some((t) => t.kind === 'object' && t.id === id)
    )
      send({
        type: ui.activation !== null ? 'activate' : 'cast',
        card: ui.selected,
        ...(ui.activation !== null ? { ability: ui.activation } : {}),
        target: ref(o),
      });
    else toast('That is not a legal target.');
    return;
  }
  if (c?.kind === 'bottom' || c?.kind === 'discard') {
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
    if (o.controller === p && o.zone === 'battlefield' && CARDS[o.name].type === 'creature') {
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
    ui.selected = ui.selected === id ? null : id;
    render();
    return;
  }
  if (!c && o.zone === 'battlefield' && o.controller === p && CARDS[o.name].activated?.length) {
    const abilities = CARDS[o.name].activated,
      legal = legalActions(state, p);
    openDialog(
      o.name,
      `<p style="margin-bottom:16px">Activated abilities use the stack. Costs are paid when you activate, not when the ability resolves.</p>`,
      abilities
        .map(
          (a, i) =>
            `<button class="btn primary" data-action="activateAbility" data-ability="${i}" ${legal.some((x) => x.type === 'activate' && x.card === id && x.ability === i) ? '' : 'disabled'}>${escape(a.text)}</button>`,
        )
        .join('') + '<button class="btn" data-action="closeDialog">Cancel</button>',
    );
    dialog._activationCard = id;
    return;
  }
  if (!c && canTapForMana(state, o, p)) {
    send({ type: 'tapMana', card: id }, { autoPass: false });
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
  if (state && ui.targeting) {
    const player = e.target.closest('[data-player]'),
      stack = e.target.closest('[data-stack]');
    let target = null;
    if (player) target = { kind: 'player', id: Number(player.dataset.player) };
    if (stack) target = { kind: 'stack', id: stack.dataset.stack };
    if (target)
      send({
        type: ui.activation !== null ? 'activate' : 'cast',
        card: ui.selected,
        ...(ui.activation !== null ? { ability: ui.activation } : {}),
        target,
      });
  }
});
app.addEventListener('pointerover', (e) => {
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
document.addEventListener('keydown', (e) => {
  if (dialog.open || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)) return;
  if (
    e.code === 'Space' &&
    state &&
    ui.view === 'play' &&
    !state.choice &&
    state.priority === viewer() &&
    !ui.replayRecord
  ) {
    e.preventDefault();
    send({ type: 'pass' }, { autoPass: false });
  }
  if (e.key === 'Escape') {
    resetSelection();
    render();
  }
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
