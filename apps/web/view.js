import {
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
    ['cards', 'Cards & decks'],
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
    : ui.deck === 'ember'
      ? 'Lightning Bolt'
      : 'Serra Angel';
  return `<main class="page"><div class="lobby-intro"><div><h2>Your next game starts here.</h2><p>Pick a deck. Find a line. Make it yours.</p></div><span class="status-label small">Local play · no account needed</span></div><div class="lobby-grid"><div><section class="deck-feature"><div class="deck-art" ${artStyle(meta, art)}></div><div class="feature-top"><span class="badge">${ui.customDeck ? 'Imported deck' : 'Featured deck'} · ${ui.customDeck?.length ?? 60} cards</span>${mana(Object.fromEntries(deck.colors.map((c) => [c, 1])))}</div><div class="feature-copy"><div class="eyebrow">${ui.customDeck ? 'Your list / local play' : ui.deck === 'ember' ? 'Tempo / spells' : 'Creatures / growth'}</div><h1>${deck.name.replace(' & ', '<br>& ')}</h1><p>${deck.description}</p><div class="feature-bottom"><span class="small muted">${ui.customDeck ? 'Validated executable definitions' : 'A handcrafted introductory deck'}</span><button class="btn small quiet" data-action="deckList">Explore deck ↗</button></div></div></section><div class="deck-tabs">${Object.entries(
    DECKS,
  )
    .map(
      ([id, d]) =>
        `<button data-action="selectDeck" data-deck="${id}" class="deck-tab ${ui.deck === id ? 'selected' : ''}"><div class="tile" ${artStyle(meta, id === 'ember' ? 'Raging Goblin' : 'Elvish Visionary')}></div><div><strong>${d.name}</strong><span>${d.colors.join(' / ')} · 60 cards</span></div></button>`,
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
export function handCard(s, id, meta, ui, playable) {
  const o = s.objects[id],
    d = definition(s, o);
  return `<button class="hand-card ${playable ? 'playable' : ''} ${ui.selected === id || ui.chosen.includes(id) ? 'selected' : ''}" data-card="${id}" aria-label="${escape(o.name)}${playable ? ', playable' : ''}" title="${escape(o.name)}">${meta[o.name]?.image ? `<img src="${escape(meta[o.name].image)}" alt="${escape(o.name)}" loading="eager">` : fallback(o.name, d)}</button>`;
}
function permanent(s, o, meta, ui, targetable) {
  const d = definition(s, o),
    land = d.type === 'land';
  if (land)
    return `<button class="land-card ${o.tapped ? 'tapped' : ''}" data-card="${o.id}" ${artStyle(meta, o.name)} title="${escape(o.name)}${o.tapped ? ' · tapped' : ''}" aria-label="${escape(o.name)}${o.tapped ? ' tapped' : ''}">${d.mana ? mana(Object.fromEntries((Array.isArray(d.mana) ? d.mana : [d.mana]).map((color) => [color, 1]))) : '—'}</button>`;
  const pt = stats(s, o),
    attacking = s.combat.attackers.some((r) => r.id === o.id),
    blocking =
      Object.values(s.combat.blocks)
        .flat()
        .some((r) => r.id === o.id) || ui.blocks.some((b) => b.blocker === o.id);
  return `<button class="permanent ${o.tapped ? 'tapped' : ''} ${attacking ? 'attacking' : ''} ${blocking ? 'blocking' : ''} ${ui.chosen.includes(o.id) || ui.selected === o.id ? 'selected' : ''} ${targetable ? 'targetable' : ''}" data-card="${o.id}" aria-label="${escape(o.name)}${o.tapped ? ' tapped' : ''}${d.type === 'creature' ? `, ${pt.power}/${pt.toughness}` : ''}"><div class="permanent-art" ${artStyle(meta, o.name)}>${o.damage ? `<span class="damage-marker">−${o.damage}</span>` : ''}${d.type === 'creature' && isSick(s, o) ? '<span class="sick-marker">NEW</span>' : ''}</div><div class="permanent-name">${escape(o.name)}</div><div class="permanent-footer"><span>${
    isPacified(s, o)
      ? 'PACIFIED'
      : d.keywords
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
        : selected.zone === 'hand'
          ? definition(s, selected).target
          : null
      : null,
    targetList = ui.targeting ? targetsFor(s, targetKind, viewer) : [];
  const phase = s.step.includes('main')
    ? 'main'
    : ['upkeep', 'draw'].includes(s.step)
      ? s.step
      : ['end', 'cleanup'].includes(s.step)
        ? 'end'
        : 'combat';
  const band = (p, bottom = false) =>
    `<div class="player-band ${bottom ? 'bottom' : ''}"><div class="avatar">${p === 0 ? 'S' : 'G'}</div><div class="player-name">${escape(s.players[p].name)}<small>${s.active === p ? 'ACTIVE PLAYER' : 'DEFENDING PLAYER'}${s.priority === p && !s.choice ? ' · PRIORITY' : ''}</small></div><button class="life ${targetList.some((t) => t.kind === 'player' && t.id === p) ? 'targetable' : ''}" data-player="${p}" aria-label="${escape(s.players[p].name)} life ${s.players[p].life}">${s.players[p].life}</button><div class="pool">${
      Object.entries(s.players[p].mana)
        .filter(([, n]) => n)
        .map(([c, n]) => `${mana({ [c]: 1 })}${n}`)
        .join('') || '<span>0 mana</span>'
    }</div><div class="zone-counts"><span class="zone-count" title="Library">▱ ${s.players[p].library.length}</span><button class="zone-count" data-action="zone" data-player="${p}" data-zone="graveyard" aria-label="${escape(s.players[p].name)} graveyard ${s.players[p].graveyard.length}">† ${s.players[p].graveyard.length}</button><button class="zone-count" data-action="zone" data-player="${p}" data-zone="exile" aria-label="Exile">◇ ${s.players[p].exile.length}</button>${
      !bottom
        ? `<div class="backs" aria-label="${s.players[p].hand.length} cards in opponent hand">${s.players[
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
    return `<section class="field" aria-label="${escape(s.players[p].name)} battlefield"><div class="lands">${lands.map((o) => permanent(s, o, meta, ui, false)).join('') || '<span class="small muted" style="font-size:9px">LANDS</span>'}</div><div class="permanents">${
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
  return `<main class="game-layout"><section class="arena">${ui.replayRecord ? `<div class="replay-banner"><span class="grow">Replay · ${ui.replayIndex}/${ui.replayRecord.commands.length} commands</span><input id="replay-position" type="range" min="0" max="${ui.replayRecord.commands.length}" value="${ui.replayIndex}" aria-label="Replay position"><button data-action="replayBack">←</button><button data-action="replayNext">Next →</button><button data-action="replaySeat" aria-label="Switch replay viewpoint">Side ${ui.seat + 1}</button><button data-action="takeoverReplay" ${s.status === 'finished' ? 'disabled' : ''}>Continue</button><button data-action="exitReplay">Exit replay</button></div>` : ''}<div class="matchbar"><span class="live-dot"></span><span>${ui.mode === 'bot' ? 'PRACTICE' : 'LOCAL TWO-PLAYER'}</span><span class="muted">/</span><span>Turn ${s.turn}</span><div class="right"><button class="btn small quiet" data-action="settings">Options</button><button class="icon-btn mobile-inspector-toggle" data-action="inspector" aria-label="Toggle inspector">◇</button><button class="icon-btn" data-action="matchMenu" aria-label="Match menu">⋯</button></div></div><div class="phase-track">${[
    ['upkeep', 'Upkeep'],
    ['draw', 'Draw'],
    ['main', 'Main'],
    ['combat', 'Combat'],
    ['main2', 'Main II'],
    ['end', 'End'],
  ]
    .map(
      ([id, label]) =>
        `<span class="phase ${(id === phase && !(phase === 'main' && s.step === 'main2')) || id === s.step ? 'active' : ''}">${label}</span>`,
    )
    .join(
      '',
    )}</div>${band(other)}${field(other)}<div class="attack-line">${s.combat.attackers.length ? `${s.combat.attackers.length} attacking · ${stepName[s.step]}` : s.status === 'mulligan' ? 'Opening hands' : stepName[s.step]}</div>${field(viewer)}${band(viewer, true)}<section class="hand-area"><div class="hand-label"><span>Your hand · ${s.players[viewer].hand.length}</span><span>${ui.targeting ? 'Choose a highlighted target' : ui.mode === 'hotseat' ? `Seat ${viewer + 1} · shared screen` : 'Click a card to inspect or play'}</span></div><div class="hand">${s.players[viewer].hand.map((id) => handCard(s, id, meta, ui, playable.has(id))).join('')}</div></section>${actionDock(s, ui, viewer, actions)}${s.status === 'finished' ? `<div class="board-notice game-over"><div class="eyebrow">Match complete</div><h2>${s.winner === null ? 'A shared ending.' : s.winner === viewer ? 'Well played.' : 'A lesson in every game.'}</h2><p>${s.winner === null ? 'The game is a draw.' : `${escape(s.players[s.winner].name)} wins.`}</p><button class="btn primary" data-action="newMatch">Play again ↗</button></div>` : ''}</section><aside class="inspector ${ui.inspectorOpen ? 'open' : ''}"><div class="inspect-head"><span>Card inspector</span><button class="mobile-inspector-toggle" data-action="inspector" aria-label="Close inspector">×</button><span>◇</span></div><div id="inspect-detail">${inspect(ui.inspect ?? selected?.name, meta, s, ui.inspectObject)}</div><div class="side-tabs"><button data-action="sideTab" data-tab="stack" class="${ui.sideTab === 'stack' ? 'active' : ''}">Stack <span class="stack-count">${s.stack.length}</span></button><button data-action="sideTab" data-tab="log" class="${ui.sideTab === 'log' ? 'active' : ''}">Game log</button></div><div class="side-content">${ui.sideTab === 'stack' ? stack(s, ui) : log(s)}</div></aside></main>`;
}
function actionDock(s, ui, p, actions) {
  let title = 'Your priority',
    desc = 'Play a card, activate a mana ability, or pass.',
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
        desc = `${ui.chosen.length} selected. Click creatures, then confirm.`;
        buttons = `<button class="btn quiet" data-action="allAttack">Select all</button><button class="btn primary" data-action="attack">${ui.chosen.length ? `Attack with ${ui.chosen.length}` : 'No attacks'} →</button>`;
        break;
      case 'blockers':
        title = 'Declare your blockers';
        desc = ui.selected
          ? 'Now click the attacker to block.'
          : 'Click your blocker, then an attacker. Click a paired blocker to undo.';
        buttons = `<button class="btn primary" data-action="block">${ui.blocks.length ? `Confirm ${ui.blocks.length} blocks` : 'No blocks'} →</button>`;
        break;
      case 'optionalEffect':
        title = `${c.name}: optional ability`;
        desc =
          'Choose whether to resolve the effect. The ability is still resolving; neither player has priority.';
        buttons =
          '<button class="btn" data-action="declineOptional">Decline</button><button class="btn primary" data-action="acceptOptional">Resolve effect →</button>';
        break;
      case 'payCost':
        title = 'Pay for ward?';
        desc = `Pay ${[...Object.entries(c.cost.mana ?? {}).map(([symbol, count]) => (symbol === 'generic' ? `${count} mana` : `${count}${symbol}`)), ...(c.cost.life ? [`${c.cost.life} life`] : [])].join(' + ') || '0'} or your spell or ability will be countered. No player receives priority during this choice.`;
        buttons = `<button class="btn" data-action="declineWard">Don't pay</button><button class="btn primary" data-action="payWard" ${c.payable ? '' : 'disabled'}>Pay ward →</button>`;
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
    desc = 'Click a highlighted creature, life total, or spell on the stack.';
    buttons = '<button class="btn" data-action="cancelSelection">Cancel</button>';
  } else if (ui.selected && s.objects[ui.selected]?.zone === 'hand') {
    const o = s.objects[ui.selected],
      d = definition(s, o),
      available = actions.some((a) => a.card === o.id);
    title = o.name;
    desc = available
      ? d.target
        ? 'Choose a target next. Mana is paid automatically.'
        : d.type === 'land'
          ? 'Playing a land does not use the stack.'
          : 'Available mana sources will be tapped automatically.'
      : 'Not playable right now. Check timing, available mana and targets.';
    buttons = `<button class="btn quiet" data-action="cancelSelection">Cancel</button><button class="btn primary" data-action="playSelected" ${!available ? 'disabled' : ''}>${d.type === 'land' ? 'Play land' : d.target ? 'Choose target' : 'Cast spell'} →</button>`;
  } else buttons = '<button class="btn primary" data-action="pass">Pass priority →</button>';
  return `<div class="action-dock" aria-live="polite"><div class="action-copy"><strong>${escape(title)}</strong><p>${escape(desc)}</p></div><div class="action-buttons">${buttons}</div></div>`;
}
export function inspect(name, meta, state = null, objectId = null) {
  if (!name || !(state?.catalog?.[name] ?? CARDS[name]))
    return '<div class="inspect-placeholder"><div><span>◇</span>A closer look.<br>Hover or select any card.</div></div>';
  const d = state?.catalog?.[name] ?? CARDS[name],
    m = meta[name];
  return `<div class="inspect-card">${m?.image ? `<img src="${escape(m.image)}" alt="${escape(name)}">` : `<div class="inspect-placeholder"><div><span>◇</span>${escape(name)}</div></div>`}</div><div class="inspect-copy"><h3>${escape(name)}</h3><div class="type">${escape(m?.type_line ?? d.type)}</div><div class="rules">${escape(m?.oracle_text ?? d.text)}</div>${state && state.objects[objectId]?.zone === 'battlefield' ? liveCharacteristics(state, state.objects[objectId]) : ''}<div class="artist">${m?.artist ? `Illustration: ${escape(m.artist)} · ` : ''}Supported executable definition${d.token ? ' · Token' : ''}</div></div>`;
}
function stack(s, ui) {
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
              `<button class="stack-item" data-stack="${e.id}"><small>${i === 0 ? 'RESOLVES NEXT' : 'WAITING'} · ${escape(s.players[e.controller].name)}</small><strong>${escape(e.name)}</strong><p>${escape(e.kind === 'ability' ? e.label : e.target ? `Target: ${e.target.kind === 'player' ? s.players[e.target.id].name : (s.objects[e.target.id]?.name ?? s.stack.find((x) => x.id === e.target.id)?.name ?? 'spell')}` : 'Spell')}</p></button>`,
          )
          .join('')
      : resolving
        ? ''
        : '<div class="empty-stack">The stack is clear.<br>Both players must pass before the game advances.</div>')
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
    )}<p style="margin-top:18px">Rules reference: Wizards’ September 25, 2026 Comprehensive Rules. This release is not a complete implementation or a certified tournament client.</p></section><section class="info-panel"><h3>One command boundary</h3><p>Every click becomes a validated command. Rejected commands leave state untouched. Revision leases reject stale input. The UI and practice bot use the same engine.</p><p style="margin-top:18px">A match can be exported and replayed without a server, Java, an account or a network request. Replays include both players’ hidden cards: share only when the match is finished and you are comfortable revealing both decks.</p><button class="btn" data-action="export" ${!s ? 'disabled' : ''}>Export current replay</button> <button class="btn quiet" data-action="loadReplay">Open replay</button><button class="btn quiet" data-action="exampleReplay">Inspect example match</button><button class="btn quiet" data-action="exampleWardReplay">Inspect ward decision</button><button class="btn quiet" data-action="exampleOptionalReplay">Inspect optional draw</button><button class="btn quiet" data-action="state" ${!s ? 'disabled' : ''}>Inspect local state</button></section><section class="info-panel"><h3>Built for extension</h3><ul><li>Hand-authored card definitions, separate from display data.</li><li>Effect opcodes with focused regression tests.</li><li>Zone incarnations protect against stale target references.</li><li>Seeded shuffles and complete command histories.</li><li>Node’s built-in test runner; no runtime dependencies.</li></ul></section><section class="info-panel"><h3>Honest boundaries</h3><p>The bot is a deterministic sparring partner, not a competitive opponent. Play is local only. The card catalog is a supported subset, not all of Magic. Official art requires a network connection; the rules do not.</p><p style="margin-top:14px">Forge is the architectural reference. This is a separate JavaScript implementation, not a complete translation of Forge or a wrapper around its Java engine.</p></section></div>${footer()}</main>`;
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
