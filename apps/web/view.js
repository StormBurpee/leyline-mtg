import { CARD_DECISIONS } from './choice-stage.js';
import { playableZone, playableCards } from '../../packages/engine/src/model.js';
import { castingChoices } from '../../packages/engine/src/spell-modes.js';
import { readableCard } from './card-inspection.js';
import { advanceLabel, stopKey } from './priority-policy.js';
import {
  spellProfile,
  CARDS,
  DECKS,
  VERSION,
  stats,
  isSick,
  isPacified,
  controlled,
  canAttack,
  canBlock,
  ref,
  legalActions,
  targetsFor,
  definition,
  hasType,
  keywords,
} from '../../packages/engine/src/index.js';
export const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const stepName = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'First main',
  beginCombat: 'Begin combat',
  attackers: 'Declare attackers',
  blockers: 'Declare blockers',
  firstDamage: 'First-strike damage',
  damage: 'Combat damage',
  endCombat: 'End combat',
  main2: 'Second main',
  end: 'End step',
  cleanup: 'Cleanup',
};
export function mana(cost) {
  return `<span class="mana-row">${Object.entries(cost)
    .map(([c, n]) =>
      c === 'generic'
        ? `<span class="mana">${n}</span>`
        : Array.from({ length: n }, () => `<span class="mana ${c}">${c}</span>`).join(''),
    )
    .join('')}</span>`;
}
export const artStyle = (meta, name) =>
  meta[name]?.art ? `style="background-image:url('${escape(meta[name].art)}')"` : '';
export function header(ui) {
  return `<header class="topbar"><button class="brand" data-action="home" aria-label="Leyline home"><img src="./mark.svg" alt="">leyline</button><nav class="topnav" aria-label="Main navigation">${[
    ['play', 'Play'],
    ['decks', 'Decks'],
    ['cards', 'Cards'],
    ['engine', 'Engine'],
  ]
    .map(
      ([id, label]) =>
        `<button data-action="nav" data-view="${id}" class="${ui.view === id ? 'active' : ''}">${label}</button>`,
    )
    .join(
      '',
    )}</nav><div class="top-right"><span class="version">ENGINE ${VERSION}</span><a class="repo-link" href="https://github.com/StormBurpee/leyline-mtg" target="_blank" rel="noopener">View source ↗</a></div></header>`;
}
export function lobby(ui, meta) {
  const catalog = ui.catalog ?? CARDS;
  const deck = ui.customDeck
    ? {
        name: 'Your imported deck',
        description: `${ui.customDeck.length} cards, validated against this executable catalog.`,
        colors: [...new Set(ui.customDeck.flatMap((name) => catalog[name]?.color ?? []))],
      }
    : DECKS[ui.deck];
  const art = ui.customDeck
    ? (ui.customDeck.find((name) => catalog[name]?.type !== 'land') ?? ui.customDeck[0])
    : deck.art;
  return `<main class="page"><div class="lobby-intro"><div><h2>Your next game starts here.</h2><p>Pick a deck. Find a line. Make it yours.</p></div><span class="status-label small">Local play · no account needed</span></div><div class="lobby-grid"><div><section class="deck-feature"><div class="deck-art" ${artStyle(meta, art)}></div><div class="feature-top"><span class="badge">${ui.customDeck ? 'Imported deck' : 'Featured deck'} · ${ui.customDeck?.length ?? 60} cards</span>${mana(Object.fromEntries(deck.colors.map((c) => [c, 1])))}</div><div class="feature-copy"><div class="eyebrow">${ui.customDeck ? 'Your list / local play' : deck.archetype}</div><h1>${deck.name.replace(' & ', '<br>& ')}</h1><p>${deck.description}</p><div class="feature-bottom"><span class="small muted">${ui.customDeck ? 'Validated executable definitions' : 'A handcrafted introductory deck'}</span><button class="btn small quiet" data-action="deckList">Explore deck ↗</button></div></div></section><div class="deck-tabs">${Object.entries(
    DECKS,
  )
    .map(
      ([id, d]) =>
        `<button data-action="selectDeck" data-deck="${id}" class="deck-tab ${ui.deck === id ? 'selected' : ''}"><div class="tile" ${artStyle(meta, d.thumbnail)}></div><div><strong>${d.name}</strong><span>${d.colors.join(' / ')} · 60 cards</span></div></button>`,
    )
    .join(
      '',
    )}</div></div><div class="setup"><section class="setup-panel"><div class="eyebrow" style="margin-bottom:18px">Across the table</div><div class="opponent-row"><div class="avatar">${ui.deck === 'ember' ? 'G' : 'E'}</div><div><strong>${DECKS[ui.deck === 'ember' ? 'grove' : 'ember'].name}</strong><p>Practice opponent · deterministic heuristic</p></div></div><div class="setup-row"><label for="mode">Play mode</label><select id="mode"><option value="bot" ${ui.mode === 'bot' ? 'selected' : ''}>Practice vs. bot</option><option value="hotseat" ${ui.mode === 'hotseat' ? 'selected' : ''}>Local two-player</option></select></div><div class="setup-row"><label for="seed">Shuffle seed</label><input type="number" id="seed" min="0" max="4294967295" value="${ui.seed}" aria-label="Shuffle seed"></div></section><section class="setup-panel"><div class="eyebrow" style="margin-bottom:15px">Real rules. Visible decisions.</div><p class="small muted">Priority passes, the stack, targets and combat are resolved by the same independent engine you can run in Node.</p><div class="options-row"><label class="toggle"><input type="checkbox" id="auto-yield" ${ui.autoYield ? 'checked' : ''}>Yield when no response is available</label><label class="toggle"><input type="checkbox" id="hold-priority" ${ui.holdPriority ? 'checked' : ''}>Hold priority after casting</label></div></section><div class="setup-actions"><button class="btn primary" data-action="start">Enter the battlefield <span>↗</span></button>${ui.saved ? '<button class="btn" data-action="resume">Resume saved match</button>' : ''}<button class="btn quiet" data-action="importDeck">Import a supported deck</button></div><p class="setup-note">This is a <strong>rules-engine preview</strong>, not full Forge parity. ${Object.values(catalog).filter((d) => !d.token).length} supported cards. No format-legality certification. Your game stays on this device.</p></div></div><div class="support-strip"><span>◇ Open source, by design</span><span>Deterministic replays</span><span>Explicit card support</span><span>Keyboard-friendly controls</span></div>${footer()}</main>`;
}
export function footer() {
  return `<footer class="footer">Leyline is an unofficial fan project. Not affiliated with Wizards of the Coast. Card names, text and art belong to their respective owners.<br>Card images served by <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>. Engine and client source: GPL-3.0-or-later.</footer>`;
}
const fallback = (name, d = CARDS[name]) =>
  `<div class="fallback"><strong>${escape(name)}</strong><p>${escape(d?.text)}</p></div>`;
export function handCard(s, id, meta, ui, playable, index = 0) {
  const o = s.objects[id],
    d = definition(s, o);
  return `<button class="hand-card ${playable ? 'playable' : ''} ${ui.selected === id || ui.chosen.includes(id) ? 'selected' : ''}" data-card="${id}" data-motion-card="${id}" data-motion-zone="hand" style="--fan:${Math.max(-4, Math.min(4, index - (s.players[s.objects[id].owner].hand.length - 1) / 2))}" aria-label="${escape(o.name)}${playable ? ', playable' : ''}" aria-description="${escape(d.text)}" title="${escape(o.name)}">${meta[o.name]?.image ? `<img src="${escape(meta[o.name].image)}" alt="${escape(o.name)}" loading="eager">` : fallback(o.name, d)}</button>`;
}
function permanent(s, o, meta, ui, targetable) {
  if (o.faceDown) o = { ...o, name: 'Face-down creature' };
  const d = definition(s, o),
    land = d.type === 'land';
  if (land)
    return `<button class="land-card ${o.tapped ? 'tapped' : ''}" data-card="${o.id}" data-motion-card="${o.id}" data-motion-zone="battlefield" ${artStyle(meta, o.name)} title="${escape(o.name)}${o.tapped ? ' · tapped' : ''}" aria-label="${escape(o.name)}${o.tapped ? ' tapped' : ''}">${d.mana ? mana(Object.fromEntries((Array.isArray(d.mana) ? d.mana : [d.mana]).map((color) => [color, 1]))) : '—'}</button>`;
  const pt = stats(s, o),
    gained = keywords(s, o).filter((keyword) => !d.keywords.includes(keyword)),
    attacking = s.combat.attackers.some((r) => r.id === o.id),
    blocking =
      Object.values(s.combat.blocks)
        .flat()
        .some((r) => r.id === o.id) || ui.blocks.some((b) => b.blocker === o.id);
  return `<button class="permanent ${o.tapped ? 'tapped' : ''} ${attacking ? 'attacking' : ''} ${blocking ? 'blocking' : ''} ${ui.chosen.includes(o.id) || ui.selected === o.id ? 'selected' : ''} ${targetable ? 'targetable' : ''}" data-card="${o.id}" data-motion-card="${o.id}" data-motion-zone="battlefield" aria-label="${escape(o.name)}${o.tapped ? ' tapped' : ''}${d.type === 'creature' ? `, ${pt.power}/${pt.toughness}` : ''}">${meta[o.name]?.image ? `<picture>${meta[o.name]?.art ? `<source media="(max-width: 900px), (max-width: 1000px) and (max-height: 600px)" srcset="${escape(meta[o.name].art)}">` : ''}<img class="battlefield-card-image" src="${escape(meta[o.name].image)}" alt="" draggable="false"></picture>` : ''}<div class="permanent-art" ${artStyle(meta, o.name)}>${o.damage ? `<span class="damage-marker">−${o.damage}</span>` : ''}${d.type === 'creature' && isSick(s, o) ? '<span class="sick-marker">NEW</span>' : ''}</div><div class="permanent-name">${escape(o.name)}</div><div class="permanent-footer"><span>${
    isPacified(s, o)
      ? 'PACIFIED'
      : [...gained, ...d.keywords]
          .slice(0, 1)
          .map((k) => k.toUpperCase())
          .join('') || d.type.toUpperCase()
  }</span>${d.type === 'creature' ? `<strong class="pt">${pt.power}/${pt.toughness}</strong>` : ''}</div></button>`;
}
export function game(s, ui, meta) {
  const viewer = ui.mode === 'hotseat' ? ui.seat : 0,
    other = 1 - viewer;
  const actions = legalActions(s, viewer),
    playable = new Set(actions.filter((a) => a.card).map((a) => a.card));
  const selected = s.objects[ui.selected],
    targetKind = selected
      ? ui.activation !== null
        ? definition(s, selected).activated?.[ui.activation]?.target
        : playableZone(s, selected, viewer)
          ? spellProfile(definition(s, selected), ui.spellMode ?? undefined)?.target
          : null
      : null,
    targetList =
      s.choice?.kind === 'triggerTarget' && s.choice.player === viewer
        ? s.choice.targets
        : ui.targeting
          ? targetsFor(s, targetKind, viewer)
          : [];
  const phase = s.step.includes('main')
    ? 'main'
    : ['upkeep', 'draw'].includes(s.step)
      ? s.step
      : ['end', 'cleanup'].includes(s.step)
        ? 'end'
        : 'combat';
  const band = (p, bottom = false) =>
    `<div class="player-band ${bottom ? 'bottom' : ''} ${targetList.some((t) => t.kind === 'player' && t.id === p) ? 'targetable-player' : ''}" data-player="${p}"><div class="avatar">${p === 0 ? 'S' : 'G'}</div><div class="player-name">${escape(s.players[p].name)}<small>${s.active === p ? 'ACTIVE PLAYER' : 'DEFENDING PLAYER'}${s.players[p].speed ? ` · SPEED ${s.players[p].speed}${s.players[p].speed === 4 ? ' MAX' : ''}` : ''}${s.priority === p && !s.choice ? ' · PRIORITY' : ''}</small><span class="compact-hand-count">${s.players[p].hand.length} cards</span></div><button class="life ${targetList.some((t) => t.kind === 'player' && t.id === p) ? 'targetable' : ''}" data-player="${p}" aria-label="${escape(s.players[p].name)} life ${s.players[p].life}">${s.players[p].life}</button><div class="pool ${Object.values(s.players[p].mana).some((amount) => amount > 0) || s.players[p].restrictedMana?.length ? '' : 'empty-pool'}">${
      Object.entries(s.players[p].mana)
        .filter(([, n]) => n)
        .map(([c, n]) => `${mana({ [c]: 1 })}${n}`)
        .join('') +
        (s.players[p].restrictedMana ?? [])
          .map(
            (unit) =>
              `<span title="${escape(unit.restriction === 'creature' ? 'Creature spells only' : `${unit.creatureType} creature spells only; uncounterable`)}">${mana({ [unit.color]: 1 })}*</span>`,
          )
          .join('') || '<span>0 mana</span>'
    }</div><div class="zone-counts"><span class="zone-count" data-library="${p}" title="Library">▱ ${s.players[p].library.length}</span><button class="zone-count" data-action="zone" data-player="${p}" data-zone="graveyard" aria-label="${escape(s.players[p].name)} graveyard ${s.players[p].graveyard.length}">† ${s.players[p].graveyard.length}</button><button class="zone-count" data-action="zone" data-player="${p}" data-zone="exile" aria-label="Exile">◇ ${s.players[p].exile.length}</button>${
      !bottom
        ? `<div class="backs" data-hand-owner="${p}" aria-label="${s.players[p].hand.length} cards in opponent hand">${s.players[
            p
          ].hand
            .slice(0, 12)
            .map(() => '<span class="card-back"></span>')
            .join('')}</div>`
        : ''
    }</div></div>`;
  const field = (p) => {
    const all = controlled(s, p),
      lands = all.filter((o) => definition(s, o).type === 'land'),
      others = all.filter((o) => definition(s, o).type !== 'land');
    return `<section class="field ${p === viewer ? 'own-field' : 'opponent-field'}" data-field="${p}" aria-label="${escape(s.players[p].name)} battlefield"><div class="lands">${lands.map((o) => permanent(s, o, meta, ui, false)).join('') || '<span class="small muted" style="font-size:9px">LANDS</span>'}</div><div class="permanents" data-scroll-key="field-${p}" style="--permanent-count:${Math.max(1, others.length)}">${
      others
        .map((o) =>
          permanent(
            s,
            o,
            meta,
            ui,
            targetList.some((t) => t.id === o.id),
          ),
        )
        .join('') ||
      '<div class="empty-field"><span class="rune">◇</span><span>Battlefield</span></div>'
    }</div></section>`;
  };
  return `<main class="game-layout ${ui.handExpanded ? 'hand-expanded' : 'hand-compact'} ${ui.targeting || s.choice?.kind === 'triggerTarget' ? 'targeting-mode' : ''}"><section class="arena">${ui.replayRecord ? `<div class="replay-banner"><span class="grow">Replay · ${ui.replayIndex}/${ui.replayRecord.commands.length} commands</span><input id="replay-position" type="range" min="0" max="${ui.replayRecord.commands.length}" value="${ui.replayIndex}" aria-label="Replay position"><button data-action="replayBack">←</button><button data-action="replayNext">Next →</button><button data-action="replaySeat" aria-label="Switch replay viewpoint">Side ${ui.seat + 1}</button><button data-action="takeoverReplay" ${s.status === 'finished' ? 'disabled' : ''}>Continue</button><button data-action="exitReplay">Exit replay</button></div>` : ''}<div class="matchbar"><span class="live-dot"></span><span class="match-mode">${ui.mode === 'bot' ? 'PRACTICE' : 'LOCAL TWO-PLAYER'}</span><span class="muted match-separator">/</span><span class="match-turn">Turn ${s.turn}</span><button class="mobile-phase-button" data-action="phaseStops" aria-label="Phase stops and turn details">${s.status === 'mulligan' ? 'Opening hand' : `${s.active === viewer ? 'Your turn' : 'Opponent'} · ${stepName[s.step]}`} ⌄</button>${s.stack.length || s.resolving ? `<button class="mobile-stack-button" data-stack-summary data-action="mobileStack" aria-expanded="${!!ui.inspectorOpen && ui.sideTab === 'stack'}">Stack ${s.stack.length + (s.resolving ? 1 : 0)}</button>` : ''}<div class="right"><button class="btn small quiet" data-action="sideTab" data-tab="log">History</button><button class="btn small quiet" data-action="settings">Options</button><button class="icon-btn mobile-inspector-toggle" data-action="inspector" aria-label="Toggle inspector">◇</button><button class="icon-btn" data-action="matchMenu" aria-label="Match menu">⋯</button></div></div><div class="phase-track"><span class="phase-owner">${s.active === viewer ? 'Your turn' : 'Opponent turn'}</span>${[
    ['upkeep', 'Upkeep'],
    ['draw', 'Draw'],
    ['main', 'Main'],
    ['combat', 'Combat'],
    ['main2', 'Main II'],
    ['end', 'End'],
  ]
    .map(
      ([id, label]) =>
        `<button data-action="toggleStop" data-stop="${stopKey(s, viewer, id === 'main' ? 'main1' : id === 'combat' ? 'beginCombat' : id)}" aria-label="Stop on ${s.active === viewer ? 'your' : 'opponent'} ${label}" aria-pressed="${!!ui.stops?.[stopKey(s, viewer, id === 'main' ? 'main1' : id === 'combat' ? 'beginCombat' : id)]}" class="phase ${(id === phase && !(phase === 'main' && s.step === 'main2')) || id === s.step ? 'active' : ''} ${ui.stops?.[stopKey(s, viewer, id === 'main' ? 'main1' : id === 'combat' ? 'beginCombat' : id)] ? 'has-stop' : ''}">${label}<i></i></button>`,
    )
    .join(
      '',
    )}<button class="phase-stop-menu" data-action="phaseStops" aria-label="Set phase stops">Stops ⋯</button></div>${band(other)}${field(other)}<div class="attack-line">${s.combat.attackers.length ? `${s.combat.attackers.length} attacking · ${stepName[s.step]}` : s.status === 'mulligan' ? 'Opening hands' : stepName[s.step]}</div>${field(viewer)}${band(viewer, true)}<section class="hand-area"><div class="hand-label"><span>Your hand · ${s.players[viewer].hand.length}</span><button data-action="handSize">${ui.handExpanded ? 'Compact hand' : 'Expand hand'}</button><button class="read-hand-card" data-action="readCard" ${readableCard(s, ui, viewer) ? '' : 'disabled'} title="Select or hold a visible card to read its rules">Read card</button><span>${ui.targeting ? 'Choose a highlighted target' : ui.mode === 'hotseat' ? `Seat ${viewer + 1} · shared screen` : 'Drag or double-click to play · hover to read'}</span></div><div class="hand ${s.players[viewer].hand.length > 10 ? 'wide-hand' : ''}" data-scroll-key="hand-${viewer}">${playableCards(
    s,
    viewer,
  )
    .map((id, index) => handCard(s, id, meta, ui, playable.has(id), index))
    .join(
      '',
    )}</div></section>${targetPrompt(s, ui, meta)}${actionDock(s, ui, viewer, actions)}${s.status === 'finished' ? `<div class="board-notice game-over"><div class="eyebrow">Match complete</div><h2>${s.winner === null ? 'A shared ending.' : s.winner === viewer ? 'Well played.' : 'A lesson in every game.'}</h2><p>${s.winner === null ? 'The game is a draw.' : `${escape(s.players[s.winner].name)} wins.`}</p><button class="btn primary" data-action="newMatch">Play again ↗</button></div>` : ''}</section><aside class="inspector ${ui.inspectorOpen ? 'open' : ''} ${s.stack.length || s.resolving ? 'stack-visible' : ''} ${ui.sideTab === 'log' ? 'log-visible' : ''}"><div class="inspect-head"><span class="desktop-inspector-label">Card inspector</span><span class="mobile-inspector-label">${ui.sideTab === 'log' ? 'Game log' : 'Stack'}</span><button class="mobile-inspector-toggle" data-action="inspector" aria-label="Close inspector">×</button><span>◇</span></div><div id="inspect-detail">${inspect(ui.inspect ?? selected?.name, meta, s, ui.inspectObject, viewer)}</div><div class="side-tabs"><button data-action="sideTab" data-tab="stack" class="${ui.sideTab === 'stack' ? 'active' : ''}">Stack <span class="stack-count">${s.stack.length}</span></button><button data-action="sideTab" data-tab="log" class="${ui.sideTab === 'log' ? 'active' : ''}">Game log</button></div><div class="side-content" data-scroll-key="sidebar-${ui.sideTab}">${ui.sideTab === 'stack' ? stack(s, ui, meta) : log(s)}</div></aside></main>`;
}
function targetPrompt(s, ui, meta) {
  const choice = s.choice?.kind === 'triggerTarget' ? s.choice : null;
  if (!ui.targeting && !choice) return '';
  const name = choice?.entry.name ?? s.objects[ui.selected]?.name,
    id = choice?.entry.source.id ?? ui.selected;
  return `<div class="target-message"><div class="pending-card" data-pending-card="${escape(id)}">${meta[name]?.image ? `<img src="${escape(meta[name].image)}" alt="${escape(name)}">` : ''}</div><div><span>CHOOSE A TARGET</span><strong>${escape(name)}</strong><p>Click a glowing target. The dotted line follows your cursor.</p></div>${choice ? '' : `<button class="btn" data-action="cancelSelection">Cancel <small>Esc</small></button>`}</div>`;
}
function actionDock(s, ui, p, actions) {
  let title = s.stack.length
      ? 'Your response'
      : s.active === p
        ? stepName[s.step]
        : 'Opponent’s turn',
    desc = s.stack.length
      ? `${s.stack.at(-1).name} is on the stack. Respond, or let it resolve.`
      : 'Drag or double-click a playable card. Hover to read it.',
    buttons = '';
  const c = s.choice;
  if (ui.replayRecord)
    return '<div class="action-dock"><div class="action-copy"><strong>Replay inspection</strong><p>Commands are replayed by the engine. Match controls are disabled.</p></div></div>';
  if (s.status === 'finished') {
    title = 'Match finished';
    desc = 'Export the replay to examine every decision.';
    buttons = '<button class="btn" data-action="export">Export replay</button>';
  } else if (ui.mode === 'hotseat' && (c?.player ?? s.priority) !== p) {
    title = `${s.players[c?.player ?? s.priority].name} to act`;
    desc = 'Local hotseat shares one screen. Switch seats before continuing.';
    buttons = '<button class="btn primary" data-action="switchSeat">Switch seat →</button>';
  } else if ((c?.player ?? s.priority) !== p) {
    title = ui.paused ? 'Opponent paused' : 'Opponent is thinking';
    desc = ui.paused
      ? 'Resume the practice opponent when you are ready.'
      : 'The bot uses the same legal-action API as you.';
    buttons = `<button class="btn" data-action="pause">${ui.paused ? 'Resume' : 'Pause'}</button>`;
  } else if (c) {
    switch (c.kind) {
      case 'mulligan':
        title = 'Find your opening hand';
        desc = `London mulligan · ${s.players[p].mulligans} taken. Keep seven, then bottom one per mulligan.`;
        buttons = `<button class="btn" data-action="mulligan" ${s.players[p].mulligans >= 7 ? 'disabled' : ''}>Mulligan</button><button class="btn primary" data-action="keep">Keep hand</button>`;
        break;
      case 'bottom':
      case 'discardEffect':
      case 'discard':
        title = `Choose ${c.count} card${c.count === 1 ? '' : 's'} to ${c.kind === 'bottom' ? 'bottom' : 'discard'}`;
        desc = `${ui.chosen.length} selected. Click cards in your hand.`;
        buttons = `<button class="btn primary" data-action="submitCards" ${ui.chosen.length !== c.count ? 'disabled' : ''}>Confirm ${c.kind === 'bottom' ? 'bottom' : 'discard'}</button>`;
        break;
      case 'attackers':
        title = 'Declare your attackers';
        desc = `${ui.chosen.length} selected. Drag toward your opponent or click creatures, then confirm.`;
        buttons = `<button class="btn quiet" data-action="allAttack">Select all</button><button class="btn primary" data-action="attack">${ui.chosen.length ? `Attack with ${ui.chosen.length}` : 'No attacks'} →</button>`;
        break;
      case 'blockers':
        title = 'Declare your blockers';
        desc = ui.selected
          ? 'Now click the attacker to block.'
          : 'Drag a blocker onto an attacker, or click both. Click a paired blocker to undo.';
        buttons = `<button class="btn primary" data-action="block">${ui.blocks.length ? `Confirm ${ui.blocks.length} blocks` : 'No blocks'} →</button>`;
        break;
      case 'triggerTarget':
        title = `${c.entry.name}: choose a target`;
        desc =
          'Select a highlighted target before this triggered ability goes onto the stack. Neither player has priority.';
        buttons =
          '<button class="btn primary" data-action="triggerTargets">List legal targets →</button>';
        break;
      case 'optionalEffect':
        title = `${c.name}: optional ability`;
        desc =
          'Choose whether to resolve the effect. The ability is still resolving; neither player has priority.';
        buttons =
          '<button class="btn" data-action="declineOptional">Decline</button><button class="btn primary" data-action="acceptOptional">Resolve effect →</button>';
        break;
      case 'exilePlay':
      case 'bindingNegotiation':
      case 'exileToGraveyard': {
        title =
          c.kind === 'exilePlay'
            ? 'Choose an exiled card to play this turn'
            : c.kind === 'bindingNegotiation'
              ? 'Revealed hand: choose a nonland to discard'
              : 'Put one of their face-up exiled cards into their graveyard?';
        desc = 'Finish this choice before resolution continues.';
        buttons =
          c.cards
            .map(
              (id) =>
                `<button class="btn" data-action="chooseResolutionCard" data-cardid="${escape(id)}" ${c.kind === 'bindingNegotiation' && definition(s, s.objects[id]).type === 'land' ? 'disabled' : ''}>${escape(s.objects[id].name)}</button>`,
            )
            .join('') +
          (c.kind !== 'exilePlay'
            ? '<button class="btn" data-action="skipResolutionCard">Choose none</button>'
            : '');
        break;
      }
      case 'auraEntry':
        title = 'Choose an Aura attachment';
        desc = 'Choose a legal permanent for the entering Aura.';
        break;
      case 'creatureType':
        title = 'Choose a creature type';
        desc = 'Choose the type for Cavern of Souls as it enters.';
        buttons = `<select id="entry-creature-type" aria-label="Creature type">${c.types.map((type) => `<option value="${escape(type)}" ${type === 'Lizard' ? 'selected' : ''}>${escape(type)}</option>`).join('')}</select><button class="btn primary" data-action="chooseCreatureType">Confirm type</button>`;
        break;
      case 'payCost':
        title = 'Pay for ward?';
        desc = `Pay ${[...Object.entries(c.cost.mana ?? {}).map(([symbol, count]) => (symbol === 'generic' ? `${count} mana` : `${count}${symbol}`)), ...(c.cost.life ? [`${c.cost.life} life`] : [])].join(' + ') || '0'} or your spell or ability will be countered. No player receives priority during this choice.`;
        buttons = `<button class="btn" data-action="declineWard">Don't pay</button><button class="btn primary" data-action="payWard" ${c.payable ? '' : 'disabled'}>Pay ward →</button>`;
        break;
      case 'legendRule':
        title = `Choose one ${c.name} to keep`;
        desc =
          'The legend rule applies before anyone gets priority. Review the copies and choose which stays.';
        buttons = '<button class="btn primary" data-action="legendRule">Choose a copy →</button>';
        break;
      case 'librarySearch':
        title = 'Search your library';
        desc = `Choose ${c.min === c.max ? c.max : `up to ${c.max}`} card${c.max === 1 ? '' : 's'}, then shuffle. The spell is still resolving.`;
        buttons =
          '<button class="btn primary" data-action="librarySearch">Search library →</button>';
        break;
      case 'libraryOrder':
        title = `${c.action === 'scry' ? 'Scry' : 'Surveil'} ${c.cards.length}`;
        desc = 'The spell is still resolving. Arrange the inspected cards before continuing.';
        buttons = '<button class="btn primary" data-action="libraryOrder">Arrange cards →</button>';
        break;
      case 'assignDamage':
        title = 'Assign combat damage';
        desc = 'Damage is simultaneous. Review or change the suggested distribution.';
        buttons =
          '<button class="btn" data-action="editDamage">Review split</button><button class="btn primary" data-action="damage">Use suggested split →</button>';
        break;
      case 'orderTriggers':
        title = 'Order your triggered abilities';
        desc = 'Put them on the stack bottom to top. The last one resolves first.';
        buttons = '<button class="btn primary" data-action="orderTriggers">Choose order →</button>';
        break;
    }
  } else if (ui.targeting) {
    title = `Target for ${s.objects[ui.selected]?.name}`;
    desc = 'Choose a highlighted target or open the legal-target list.';
    buttons = `${castingChoices(definition(s, s.objects[ui.selected])) ? '<button class="btn" data-action="spellModes">Change mode</button>' : ''}<button class="btn" data-action="cancelSelection">Cancel</button><button class="btn primary" data-action="spellTargets">List legal targets →</button>`;
  } else if (ui.selected && playableZone(s, s.objects[ui.selected], p)) {
    const o = s.objects[ui.selected],
      d = definition(s, o),
      available = actions.some((a) => a.card === o.id && ['cast', 'playLand'].includes(a.type));
    title = o.name;
    desc = available
      ? castingChoices(d)
        ? 'Choose one mode, then any required target. Mana is paid when you cast.'
        : d.target
          ? 'Choose a target next. Mana is paid automatically.'
          : d.type === 'land'
            ? 'Playing a land does not use the stack.'
            : 'Available mana sources will be tapped automatically.'
      : 'Not playable right now. Check timing, available mana and targets.';
    buttons = `${actions.some((a) => a.type === 'cycle' && a.card === o.id) ? `<button class="btn" data-action="cycleSelected">Cycle ${mana(d.cycling)}</button>` : ''}<button class="btn quiet" data-action="cancelSelection">Cancel</button><button class="btn primary" data-action="playSelected" ${!available ? 'disabled' : ''}>${d.type === 'land' ? 'Play land' : castingChoices(d) ? 'Choose mode' : d.target ? 'Choose target' : 'Cast spell'} →</button>`;
  } else
    buttons = `<button class="btn primary advance-button" data-action="pass">${advanceLabel(s, p)} <span>→</span><small>Space</small></button>`;
  if (c && c.player === p && CARD_DECISIONS.has(c.kind))
    buttons =
      '<button class="btn primary" data-action="reviewDecision">View cards & choose →</button>';
  return `<div class="action-dock" aria-live="polite"><div class="action-copy"><strong>${escape(title)}</strong><p>${escape(desc)}</p></div><div class="action-buttons"><button class="btn quiet short-read-card" data-action="readCard" ${readableCard(s, ui, p) ? '' : 'disabled'} aria-label="Read selected card">Read</button>${ui.yieldMode ? '<button class="btn short-yield-stop" data-action="cancelYield">Stop passing</button>' : ''}${buttons}</div>${ui.mode === 'bot' && s.status === 'playing' ? `<div class="priority-controls"><button data-action="toggleFullControl" aria-pressed="${ui.controlMode === 'full'}" title="Full control: stop at every priority window (F)">${ui.controlMode === 'full' ? '● Full control' : '○ Smart play'}</button>${ui.yieldMode ? `<button class="yield-active" data-action="cancelYield">Auto-passing · Stop ×</button>` : `<button data-action="yieldResponse" title="Pass until an opponent puts a new effect on the stack (Enter)">Pass until response</button><button data-action="yieldTurn" title="Pass through this turn, including responses (Shift+Enter)">Pass turn</button>`}<button data-action="prioritySettings" aria-label="Priority automation settings">⚙</button></div>` : ''}</div>`;
}
export function inspect(name, meta, state = null, objectId = null, viewer = null) {
  const object = state?.objects[objectId];
  if (object?.faceDown && object.controller !== viewer)
    return '<div class="inspect-copy"><h3>Face-down creature</h3><p>Colorless 2/2 creature with ward {2}. Its identity is concealed.</p></div>';

  if (!name || !(state?.catalog?.[name] ?? CARDS[name]))
    return '<div class="inspect-placeholder"><div><span>◇</span>A closer look.<br>Hover or select any card.</div></div>';
  const d = state?.catalog?.[name] ?? CARDS[name],
    m = meta[name];
  return `<div class="inspect-card">${m?.image ? `<img src="${escape(m.image)}" alt="${escape(name)}">` : `<div class="inspect-placeholder"><div><span>◇</span>${escape(name)}</div></div>`}</div><div class="inspect-copy"><h3>${escape(name)}</h3><div class="type">${escape(m?.type_line ?? `${d.legendary ? 'Legendary ' : ''}${d.type}`)}</div><div class="rules">${escape(m?.oracle_text ?? d.text)}</div>${state && state.objects[objectId]?.zone === 'battlefield' ? liveCharacteristics(state, state.objects[objectId]) : ''}<div class="artist">${m?.artist ? `Illustration: ${escape(m.artist)} · ` : ''}Supported executable definition${d.token ? ' · Token' : ''}</div></div>`;
}
function stack(s, ui, meta = {}) {
  const resolving = s.resolving
    ? `<div class="stack-item resolving"><small>RESOLVING · ${escape(s.players[s.resolving.entry.controller].name)}</small><strong>${escape(s.resolving.entry.name)}</strong><p>Waiting for a choice. Priority is not available.</p></div>`
    : '';
  return (
    resolving +
    (s.stack.length
      ? s.stack
          .slice()
          .reverse()
          .map(
            (e, i) =>
              `<button class="stack-item" data-stack="${e.id}" ${e.kind === 'spell' ? `data-motion-card="${e.source.id}" data-motion-zone="stack"` : ''}>${meta[e.name]?.image ? `<img class="stack-card-art" src="${escape(meta[e.name].image)}" alt="" draggable="false">` : ''}<small>${i === 0 ? 'RESOLVES NEXT' : 'WAITING'} · ${escape(s.players[e.controller].name)}</small><strong>${escape(e.name)}</strong><p>${escape([e.kind === 'ability' ? e.label : e.modeLabel ? `Mode: ${e.modeLabel}` : !e.target ? 'Spell' : '', e.target ? `Target: ${e.target.kind === 'player' ? s.players[e.target.id].name : (s.objects[e.target.id]?.name ?? s.stack.find((x) => x.id === e.target.id)?.name ?? 'spell')}` : ''].filter(Boolean).join(' · '))}</p></button>`,
          )
          .join('')
      : resolving
        ? ''
        : `<div class="empty-stack">${s.choice?.kind === 'triggerTarget' ? 'A triggered ability is waiting for its target.<br>Choose before priority resumes.' : 'The stack is clear.<br>Both players must pass before the game advances.'}</div>`)
  );
}
export function eventText(e, s) {
  const name = e.name ?? s.objects[e.objectId]?.name ?? 'a card',
    p = s.players[e.player]?.name ?? '';
  switch (e.type) {
    case 'cast':
      return `${p} cast ${name}.`;
    case 'activated':
      return `${p} activated ${name}.`;
    case 'land':
      return `${p} played ${name}.`;
    case 'resolved':
      return `${name} resolved.`;
    case 'fizzled':
      return `${name} had no legal target and did not resolve.`;
    case 'countered':
      return `${name} was countered.`;
    case 'lifeLost':
      return `${p} lost ${e.amount} life.`;
    case 'damage':
      return `${e.amount} damage to ${e.target.kind === 'player' ? s.players[e.target.id].name : (s.objects[e.target.id]?.name ?? 'a creature')}.`;
    case 'draw':
      return `${p} drew a card.`;
    case 'lifeGain':
      return `${p} gained ${e.amount} life.`;
    case 'attackers':
      return `${p} declared ${e.ids.length} attackers.`;
    case 'blockers':
      return `${p} declared ${e.pairs.length} blockers.`;
    case 'cycled':
      return `${p} cycled ${name}.`;
    case 'legendChosen':
      return `${p} chose which ${name} to keep (legend rule).`;
    case 'triggered':
      return `${name} triggered.`;
    case 'turn':
      return `Turn ${e.turn}: ${p}.`;
    case 'gameOver':
      return e.winner === null
        ? 'The game ended in a draw.'
        : `${s.players[e.winner].name} won (${e.reason}).`;
    case 'zoneChange':
      return e.to === 'graveyard' ? `${name} went to the graveyard.` : null;
    default:
      return null;
  }
}
function log(s) {
  return s.events
    .slice()
    .reverse()
    .map((e) => ({ e, text: eventText(e, s) }))
    .filter((x) => x.text)
    .slice(0, 40)
    .map(
      ({ e, text }) =>
        `<div class="log-row"><span class="log-seq">${e.seq}</span><span>${escape(text)}</span></div>`,
    )
    .join('');
}
export function catalog(ui, meta) {
  const cards = Object.values(ui.catalog ?? CARDS).filter(
    (d) =>
      !d.token &&
      d.name.toLowerCase().includes(ui.query.toLowerCase()) &&
      (ui.filter === 'all' || hasType(d, ui.filter)),
  );
  return `<main class="page"><div class="section-head"><div><div class="eyebrow" style="margin-bottom:12px">The playable collection</div><h2>Every card here has rules.</h2><p>No placeholders in your deck. Unsupported imports are rejected explicitly.</p></div><button class="btn" data-action="importDeck">Import deck ↗</button></div><div class="catalog-controls"><input id="card-search" type="search" placeholder="Find a supported card…" value="${escape(ui.query)}" aria-label="Search supported cards"><select id="card-filter" aria-label="Card type">${['all', 'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land'].map((t) => `<option value="${t}" ${ui.filter === t ? 'selected' : ''}>${t === 'all' ? 'All types' : t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select><span class="small muted">${cards.length} cards</span></div><div class="catalog-grid">${cards.map((d) => `<button class="catalog-card" data-inspect="${escape(d.name)}">${meta[d.name]?.image ? `<img src="${escape(meta[d.name].image)}" alt="${escape(d.name)}" loading="lazy">` : `<div class="catalog-fallback">${escape(d.name)}</div>`}<strong>${escape(d.name)}</strong><small>${escape(meta[d.name]?.type_line ?? d.type)}</small></button>`).join('')}</div>${footer()}</main>`;
}
export function enginePage(s) {
  return `<main class="page"><div class="section-head"><div><div class="eyebrow" style="margin-bottom:12px">Under the tabletop</div><h2>A rules engine you can inspect.</h2><p>Pure JavaScript. Explicit commands. Reproducible decisions.</p></div><a class="btn" href="https://github.com/StormBurpee/leyline-mtg" target="_blank" rel="noopener">Open repository ↗</a></div><div class="engine-grid"><section class="info-panel"><h3>Implemented rule families</h3>${[
    ['Priority & LIFO stack', 'Implemented'],
    ['Mana payment & timing', 'Implemented'],
    ['London mulligans', 'Implemented'],
    ['Combat & damage assignment', 'Implemented'],
    ['ETB triggers & APNAP ordering', 'Implemented'],
    ['State-based actions', 'Scoped subset'],
    ['Continuous effects', 'Anthem / temporary stats'],
    ['Commander / multiplayer', 'Not yet'],
    ['Layers / replacement effects', 'Not yet'],
  ]
    .map(
      ([a, b]) =>
        `<div class="rule-row ${b === 'Implemented' ? '' : 'partial'}"><span>${a}</span><span>${b}</span></div>`,
    )
    .join(
      '',
    )}<p style="margin-top:18px">Rules reference: Wizards’ September 25, 2026 Comprehensive Rules. This release is not a complete implementation or a certified tournament client.</p></section><section class="info-panel"><h3>One command boundary</h3><p>Every click becomes a validated command. Rejected commands leave state untouched. Revision leases reject stale input. The UI and practice bot use the same engine.</p><p style="margin-top:18px">A match can be exported and replayed without a server, Java, an account or a network request. Replays include both players’ hidden cards: share only when the match is finished and you are comfortable revealing both decks.</p><button class="btn" data-action="export" ${!s ? 'disabled' : ''}>Export current replay</button> <button class="btn quiet" data-action="loadReplay">Open replay</button><button class="btn quiet" data-action="exampleModalReplay">Inspect modal spell</button><button class="btn quiet" data-action="exampleAttackReplay">Inspect attack triggers</button><button class="btn quiet" data-action="exampleLegendReplay">Inspect legend rule</button><button class="btn quiet" data-action="exampleSearchReplay">Inspect library search</button><button class="btn quiet" data-action="exampleSacrificeReplay">Inspect sacrifice position</button><button class="btn quiet" data-action="exampleBurialReplay">Inspect reanimation position</button><button class="btn quiet" data-action="exampleInteractionReplay">Inspect interactive position</button><button class="btn quiet" data-action="exampleReplay">Inspect example match</button><button class="btn quiet" data-action="exampleWardReplay">Inspect ward decision</button><button class="btn quiet" data-action="exampleTargetReplay">Inspect triggered target</button><button class="btn quiet" data-action="exampleOptionalReplay">Inspect optional draw</button><button class="btn quiet" data-action="state" ${!s ? 'disabled' : ''}>Inspect local state</button></section><section class="info-panel"><h3>Built for extension</h3><ul><li>Versioned card source packs, compiled separately from display data.</li><li>Effect opcodes with focused regression tests.</li><li>Zone incarnations protect against stale target references.</li><li>Seeded shuffles and complete command histories.</li><li>Node’s built-in test runner; no runtime dependencies.</li></ul></section><section class="info-panel"><h3>Honest boundaries</h3><p>The bot is a deterministic sparring partner, not a competitive opponent. Play is local only. The card catalog is a supported subset, not all of Magic. Official art requires a network connection; the rules do not.</p><p style="margin-top:14px">Forge is the architectural reference. This is a separate JavaScript implementation, not a complete translation of Forge or a wrapper around its Java engine.</p></section></div>${footer()}</main>`;
}

function liveCharacteristics(s, o) {
  const d = definition(s, o),
    bits = [];
  if (d.type === 'creature') {
    const pt = stats(s, o);
    bits.push(`${pt.power}/${pt.toughness} now`);
    if (o.plusCounters) bits.push(`+${o.plusCounters} counter${o.plusCounters === 1 ? '' : 's'}`);
    if (o.damage) bits.push(`${o.damage} damage`);
  }
  const gained = keywords(s, o).filter((keyword) => !d.keywords.includes(keyword));
  if (gained.length) bits.push(`Gained: ${gained.join(', ')}`);
  if (o.stunCounters) bits.push(`${o.stunCounters} stun counter${o.stunCounters === 1 ? '' : 's'}`);
  if (o.tapped) bits.push('Tapped');
  if (isPacified(s, o)) bits.push('Pacified');
  if (o.attachedTo) {
    const target = s.objects[o.attachedTo.id];
    if (target) bits.push(`Attached to ${target.name}`);
  }
  return bits.length
    ? `<div class="live-characteristics">${bits.map(escape).join(' · ')}</div>`
    : '';
}

export function legendChoiceBody(state, metadata = {}) {
  const c = state.choice;
  if (c?.kind !== 'legendRule') return '';
  return `<p>Keep one ${escape(c.name)}. The other copies go to their owners’ graveyards, even if indestructible. Other state-based actions still apply.</p><div class="library-group">${c.cards
    .map((id, index) => {
      const o = state.objects[id],
        d = definition(state, o),
        pt = stats(state, o);
      return `<div class="library-choice"><div class="library-thumb">${metadata[o.name]?.image ? `<img src="${escape(metadata[o.name].image)}" alt="">` : '◇'}</div><div class="library-choice-body"><strong>Copy ${index + 1}: ${escape(o.name)}</strong><span class="small muted">${d.type === 'creature' ? `${pt.power}/${pt.toughness} · ${o.damage} damage · ` : ''}${o.tapped ? 'Tapped' : 'Untapped'}${o.plusCounters ? ` · ${o.plusCounters} +1/+1 counters` : ''}</span><div class="library-choice-actions"><button class="btn primary" data-action="keepLegend" data-cardid="${id}">Keep this copy</button><button class="btn" data-action="readLegend" data-cardid="${id}">Read card</button></div></div></div>`;
    })
    .join('')}</div>`;
}

export function spellModeBody(state, player, id) {
  const card = definition(state, state.objects[id]);
  const legal = legalActions(state, player).filter((a) => a.type === 'cast' && a.card === id);
  return `<p>Choose how to cast this spell. Targets and payment are announced before the spell goes onto the stack.</p><div class="target-grid">${(
    castingChoices(card) ?? []
  )
    .map((mode, index) => {
      const available = legal.some((a) => a.mode === index);
      return `<button class="btn target-option" data-action="chooseSpellMode" data-mode="${index}" ${available ? '' : 'disabled'}><strong>${escape(mode.label)}</strong><span>${available ? (mode.target ? 'Choose target next' : 'Cast this mode') : 'Unavailable: check targets, mana and timing'}</span></button>`;
    })
    .join('')}</div>`;
}
