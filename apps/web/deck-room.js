import { CARDS, DECKS, expandDeck, validateDeck } from '../../packages/engine/src/index.js';
import { escape, artStyle, mana, footer } from './view.js';

export const DECK_LIBRARY_KEY = 'leyline.decks.v1';
export function readDeckLibrary(storage) {
  try {
    const value = JSON.parse(storage.getItem(DECK_LIBRARY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (d) =>
          d &&
          typeof d.id === 'string' &&
          typeof d.name === 'string' &&
          d.cards &&
          typeof d.cards === 'object' &&
          !Array.isArray(d.cards) &&
          Object.entries(d.cards).every(
            ([name, n]) => name.length < 160 && Number.isInteger(n) && n > 0 && n <= 250,
          ) &&
          Object.values(d.cards).reduce((a, b) => a + b, 0) <= 250,
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
export function deckEntries(ui) {
  return [
    ...Object.entries(DECKS),
    ...ui.personalDecks.map((d) => [
      d.id,
      {
        ...d,
        colors: [...new Set(Object.keys(d.cards).flatMap((n) => CARDS[n]?.color ?? []))],
        art: Object.keys(d.cards).find((n) => CARDS[n]?.type !== 'land'),
        archetype: 'Your collection',
        description: 'A list saved on this device. Edit it, export it, or bring it to the table.',
        personal: true,
      },
    ]),
  ];
}
export function selectedDeck(ui) {
  return deckEntries(ui).find(([id]) => id === ui.deck)?.[1] ?? DECKS.ember;
}
export const deckProblems = (d) => validateDeck(expandDeck(d.cards));
export function curve(cards) {
  const values = Array(8).fill(0);
  for (const [name, count] of Object.entries(cards)) {
    const d = CARDS[name];
    if (!d || d.type === 'land') continue;
    const value = Object.values(d.cost).reduce((a, b) => a + b, 0);
    values[Math.min(7, value)] += count;
  }
  const max = Math.max(1, ...values);
  return `<div class="mana-curve" aria-label="Mana curve">${values.map((n, i) => `<div title="Mana value ${i}${i === 7 ? '+' : ''}: ${n} cards"><span>${n || ''}</span><i style="--bar:${(n / max) * 100}%"></i><small>${i === 7 ? '7+' : i}</small></div>`).join('')}</div>`;
}
export function deckRoom(ui, meta) {
  const entries = deckEntries(ui),
    deck = selectedDeck(ui),
    problems = deckProblems(deck);
  const visible = entries.filter(
    ([, d]) =>
      `${d.name} ${d.archetype}`.toLowerCase().includes(ui.deckQuery.toLowerCase()) &&
      (ui.deckColor === 'all' || d.colors.includes(ui.deckColor)),
  );
  const opponent = entries.find(([id]) => id === ui.opponentDeck)?.[1] ?? DECKS.grove;
  const total = Object.values(deck.cards).reduce((a, b) => a + b, 0);
  return `<main class="deck-room"><section class="room-heading"><div><span class="eyebrow">YOUR TABLE. YOUR TERMS.</span><h1>The deck room<span>.</span></h1></div><div class="room-tools">${ui.recoveredDraft ? '<button class="btn quiet" data-action="resumeDraft">Resume draft</button>' : ''}${ui.saved ? '<button class="btn" data-action="resume">Resume match ↗</button>' : ''}<button class="btn" data-action="importDeck">Import list</button><button class="btn primary" data-action="newDeck">＋ Build a deck</button></div></section>
  <section class="deck-spotlight"><div class="spotlight-art" ${artStyle(meta, deck.art)}></div><div class="spotlight-copy"><span class="eyebrow">${escape(deck.archetype)}</span><h2>${escape(deck.name)}</h2><p>${escape(deck.description)}</p><div class="spotlight-tags">${mana(Object.fromEntries(deck.colors.map((c) => [c, 1])))}<span>${total} cards</span><span>${problems.length ? 'Needs attention' : 'Ready to play'}</span></div><div class="spotlight-buttons"><button class="btn" data-action="editDeck">${deck.personal ? 'Edit list' : 'Customize deck'}</button><button class="btn quiet" data-action="deckList">View all cards ↗</button></div></div><div class="match-launch"><span class="eyebrow">SET THE MATCHUP</span><label for="opponent-deck">Opponent deck</label><select id="opponent-deck">${entries
    .filter(([, d]) => !deckProblems(d).length)
    .map(
      ([id, d]) =>
        `<option value="${escape(id)}" ${id === ui.opponentDeck ? 'selected' : ''}>${escape(d.name)}</option>`,
    )
    .join(
      '',
    )}</select><label for="mode">Play mode</label><select id="mode"><option value="bot" ${ui.mode === 'bot' ? 'selected' : ''}>Practice against bot</option><option value="hotseat" ${ui.mode === 'hotseat' ? 'selected' : ''}>Local two-player</option></select><button class="btn primary launch-button" data-action="start" ${problems.length ? 'disabled' : ''}>Play ${escape(deck.name)} <span>↗</span></button><span class="launch-note">${problems.length ? escape(problems[0]) : `vs. ${escape(opponent.name)} · local game`}</span><details class="match-advanced"><summary>Match preferences</summary><label for="seed">Shuffle seed<input id="seed" type="number" min="0" max="4294967295" value="${ui.seed}"></label><label><input id="auto-yield" type="checkbox" ${ui.autoYield ? 'checked' : ''}> Auto-yield empty responses</label><label><input id="hold-priority" type="checkbox" ${ui.holdPriority ? 'checked' : ''}> Hold priority after casting</label></details></div></section>
  <section class="deck-shelf"><div class="shelf-toolbar"><h2>Your decks <span>${entries.length}</span></h2><div class="shelf-filters"><input id="deck-search" type="search" placeholder="Find a deck…" aria-label="Search decks" value="${escape(ui.deckQuery)}"><div class="color-filters" aria-label="Filter decks by color">${['all', 'W', 'U', 'B', 'R', 'G'].map((c) => `<button data-action="deckColor" data-color="${c}" aria-label="${c === 'all' ? 'All colors' : c}" aria-pressed="${ui.deckColor === c}" class="${ui.deckColor === c ? 'active' : ''}">${c === 'all' ? 'All' : mana({ [c]: 1 })}</button>`).join('')}</div></div></div><div class="deck-gallery">${
    visible
      .map(([id, d]) => {
        const issues = deckProblems(d);
        return `<button class="deck-box ${ui.deck === id ? 'selected' : ''}" data-action="selectDeck" data-deck="${escape(id)}" aria-pressed="${ui.deck === id}"><div class="deck-box-art" ${artStyle(meta, d.art)}></div><span class="deck-box-status">${issues.length ? 'Incomplete list' : ui.deck === id ? 'Selected' : d.personal ? 'Saved deck' : 'Starter deck'}</span><div class="deck-box-content"><div class="deck-box-mana">${mana(Object.fromEntries(d.colors.map((c) => [c, 1])))}</div><h3>${escape(d.name)}</h3><p>${escape(d.archetype)}</p><span>${Object.values(d.cards).reduce((a, b) => a + b, 0)} cards <b>↗</b></span></div></button>`;
      })
      .join('') || '<p class="empty-library">No decks match these filters.</p>'
  }<button class="new-deck-tile" data-action="newDeck"><span>＋</span><strong>Something of your own</strong><small>Build from the executable card pool</small></button></div></section><p class="library-disclosure">Starter lists are for exploring the engine, not competitive or format-certified decks. ${Object.values(CARDS).filter((d) => !d.token).length} executable cards. Unsupported cards are never substituted.</p>${footer()}</main>`;
}
export function deckBuilder(ui, meta) {
  const draft = ui.deckDraft,
    entries = Object.entries(draft.cards),
    total = entries.reduce((n, [, count]) => n + count, 0);
  const problems = deckProblems(draft);
  const cards = Object.values(CARDS).filter(
    (d) =>
      !d.token &&
      `${d.name} ${d.text}`.toLowerCase().includes(ui.builderQuery.toLowerCase()) &&
      (ui.builderColor === 'all' || d.color.includes(ui.builderColor)) &&
      (ui.builderType === 'all' || d.type === ui.builderType),
  );
  const groups = [
    'creature',
    'instant',
    'sorcery',
    'enchantment',
    'artifact',
    'land',
    'unsupported',
  ];
  return `<main class="deck-builder" data-builder-panel="${ui.builderPanel === 'list' ? 'list' : 'pool'}"><header class="builder-header"><button class="btn quiet" data-action="closeBuilder">← Deck room</button><input id="deck-name" value="${escape(draft.name)}" maxlength="80" aria-label="Deck name"><div><button class="btn" data-action="exportDraft">Export list</button><button class="btn primary" data-action="saveDraft">Save deck</button></div></header><nav class="builder-panels" aria-label="Deck builder panels"><button data-action="builderPanel" data-panel="pool" aria-pressed="${ui.builderPanel !== 'list'}" aria-controls="builder-pool-panel">Browse cards</button><button data-action="builderPanel" data-panel="list" aria-pressed="${ui.builderPanel === 'list'}" aria-controls="builder-list-panel">My deck <b>${total}</b></button></nav><div class="builder-layout"><section class="builder-pool" id="builder-pool-panel"><div class="builder-search"><input id="builder-search" type="search" placeholder="Search cards or rules text…" aria-label="Search builder cards" value="${escape(ui.builderQuery)}"><select id="builder-color" aria-label="Card color">${['all', 'W', 'U', 'B', 'R', 'G'].map((c) => `<option value="${c}" ${ui.builderColor === c ? 'selected' : ''}>${c === 'all' ? 'All colors' : c}</option>`).join('')}</select><select id="builder-type" aria-label="Card type">${['all', ...groups.slice(0, -1)].map((t) => `<option value="${t}" ${ui.builderType === t ? 'selected' : ''}>${t === 'all' ? 'All types' : t}</option>`).join('')}</select></div><div class="builder-pool-caption"><span>${cards.length} executable cards</span><span>Read a card · add it below</span></div><div class="builder-cards" data-scroll-key="builder-pool">${cards
    .map((d) => {
      const count = draft.cards[d.name] ?? 0;
      return `<div class="builder-card" data-name="${escape(d.name)}" draggable="true"><button class="builder-card-preview" data-action="inspectDraftCard" data-name="${escape(d.name)}" aria-label="Read ${escape(d.name)}">${meta[d.name]?.image ? `<img src="${escape(meta[d.name].image)}" alt="" loading="lazy" draggable="false">` : `<div class="builder-card-fallback">${escape(d.name)}${mana(d.cost)}</div>`}</button><button class="builder-card-add" data-action="addDraftCard" data-name="${escape(d.name)}" aria-label="Add ${escape(d.name)}" ${count >= 4 && !d.basic ? 'disabled' : ''}>${count ? `${count} in deck` : 'Add card'} <b aria-hidden="true">＋</b></button></div>`;
    })
    .join(
      '',
    )}</div></section><aside class="builder-list" id="builder-list-panel" data-deck-drop><div class="builder-list-head"><h2>${total}<span> cards</span></h2><span class="${problems.length ? 'muted' : 'ready-label'}">${problems.length ? 'Draft' : 'Ready to play'}</span></div>${curve(draft.cards)}<div class="deck-validation ${problems.length ? 'has-problems' : ''}" role="status">${
    problems.length
      ? problems
          .slice(0, 4)
          .map((p) => `<p>${escape(p)}</p>`)
          .join('')
      : 'All cards supported. Constructed size and copy limits satisfied.'
  }</div><div class="builder-list-scroll" data-scroll-key="builder-list">${
    groups
      .map((type) => {
        const group = entries.filter(([n]) => (CARDS[n]?.type ?? 'unsupported') === type);
        return group.length
          ? `<section class="deck-type-group"><h3>${type} <span>${group.reduce((a, [, n]) => a + n, 0)}</span></h3>${group.map(([n, count]) => `<div class="builder-list-row"><button data-action="removeDraftCard" data-name="${escape(n)}" aria-label="Remove one ${escape(n)}">−</button><b>${count}</b><button class="builder-list-name" data-action="inspectDraftCard" data-name="${escape(n)}" data-inspect="${escape(n)}">${escape(n)}</button><button data-action="addDraftCard" data-name="${escape(n)}" aria-label="Add one ${escape(n)}" ${count >= 4 && !CARDS[n]?.basic ? 'disabled' : ''}>＋</button></div>`).join('')}</section>`
          : '';
      })
      .join('') ||
    '<div class="deck-empty"><span>◇</span><h3>Start with a card you love.</h3><p>Add cards from the collection. Your mana curve and deck list will take shape here.</p></div>'
  }</div><button class="btn primary" data-action="saveAndPlayDraft" ${problems.length ? 'disabled' : ''}>Save & select deck ↗</button></aside></div></main>`;
}
