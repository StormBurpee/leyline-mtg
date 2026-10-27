# The tabletop client

The UI submits the same commands as the CLI and simulation policies. Dragging never moves a card in engine state until a legal command is accepted.

## Card-first decision stage (v0.27)

Required card decisions open automatically over a dimmed battlefield. Fireglass/exile choices, opening hands, mulligan bottoming, discards, legend choices, searches, ward and optional effects use one shared presentation. Readable card fronts, named captions, gold selection marks and explicit confirmation replace tiny name-only choices.

- **View battlefield / Escape:** dismisses only the presentation. The engine choice remains pending; use **View cards & choose** to return. Selection and ordering drafts are retained.
- **Read card:** opens the printed card plus a large rules-text panel; Back to cards returns to the same draft.
- **Scry / surveil:** separate library and bottom/graveyard lanes, ordered left-to-right. Drag cards between lanes or use the touch/keyboard move and order buttons.
- **Searches / public zones:** large card grids, name filtering and visible copy counts. Search choices remain provisional until confirmation.
- **Graveyard targets:** image-based selection and a separate target confirmation. The selected command retains its original revision and incarnation handles.
- **Mulligans:** a large seven-card opening-hand view, clear Keep/Mulligan actions and a separate bottom-card selection after keeping.
- **Accessibility:** native modal focus containment, named controls, explicit selection state, non-drag alternatives, image-failure rules text and reduced-motion support.

The visual references were Wizards' [Streets of New Capenna Hideaway choice](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-streets-new-capenna-2022-04-21) and [Kaldheim Foretell choice](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21). Leyline retains its own forest/gold palette and typography; no Arena interface assets are shipped.

DOM lifecycle tests execute the actual client controls for mulligan, Fireglass, scry, surveil, search, legend, optional and ward decisions, including dismiss/read/return/confirm paths. These tests do not verify pixel layout or native-browser behaviour. Fresh native-browser visual QA has not been completed for this update; the managed preview and authenticated browser route were unavailable.

## Controls

- **Play a land or untargeted spell:** drag from your hand onto your battlefield.
- **Cast a targeted spell:** drag onto a highlighted player, permanent or spell. Stack targets also appear in a temporary central tray, including on narrow screens.
- **Attack:** during attacker selection, drag a creature toward the opposing battlefield. Confirm the complete attacking group with the action button.
- **Block:** during blocker selection, drag a blocker onto a legal attacker. Click an assigned blocker to remove its assignment. Confirm the complete blocking group afterward.
- **Cancel a drag:** release away from a legal drop zone or press Escape. Pointer cancellation, lost capture, window blur and resizing also return the card.
- **Without dragging:** click a card and use the action dock. All controls are keyboard-focusable. Space passes priority when focus is outside a control.
- **Motion:** Table preferences has a persistent Reduce motion option. The operating system's reduced-motion preference is always respected.

Cards lift and return, hands reflow, tapped cards turn, and visible cards transition between zones. Life deltas and combat links explain consequences. These are presentation effects, never replay events. Newly created tokens appear on the battlefield rather than pretending to be drawn from a library. Opponent card identities are not exposed by draw animation.

## Implementation

- `drop-plan.js` projects engine legal actions and combat predicates into drop destinations.
- `gestures.js` handles pointer thresholds, capture, drag presentation and cancellation.
- `motion.js` snapshots visible DOM positions and animates after accepted state changes.
- `choice-stage.js` and `choice-stage.css` provide reusable large-card decision presentation.
- `app.js` owns the command boundary, revision checks, timers and selection state.

Bot/automatic-yield timers pause while a card is held. A stale revision cannot turn an old target highlight into an accepted command. Gesture selection of attackers/blockers is provisional until the entire declaration is submitted.

## Verification

The gesture tests cover ordinary clicks, movement thresholds, cancellation, blur, lost capture, horizontal touch-scroll intent, repeated drags, rejected submissions and synthetic-click suppression. Command-projection tests exercise real replay positions, stale revisions, target restrictions and combat legality.

Manual Chromium checks on October 26, 2026 exercised:

- Land drag from hand to battlefield, followed by normal click selection.
- Lightning Bolt dropped on a player, actual mana payment, trigger resolution and life loss.
- Invalid enchantment target returning without spending mana or removing the card.
- Shock dropped on Youthful Knight, followed by ordering real cast triggers.
- Counterspell dropped onto a spell beneath multiple triggered abilities.
- Selecting two attackers by drag, then confirming the group.
- Rejecting a non-flying blocker against a flying attacker; assigning a legal ground block, undoing it, repeating the drag and immediately confirming.
- Reduced-motion preference persistence and removal of hand transforms.
- A real targeted drag at 400 CSS pixels, with no horizontal page overflow.

This is not a claim of exhaustive browser or device coverage. Physical touchscreen, Safari and Firefox verification remain open. The gesture harness is not a substitute for those checks.

The v0.8 target-choice browser check used the shipped Exclusion Mage replay: an own-creature target was rejected, closing the legal-target list preserved the pending choice, and both the list and direct battlefield selection put the ability onto the stack targeting Serra Angel. Soul Warden resolved first in APNAP order; Serra Angel then returned to its owner's hand.

For v0.9, a real Poison Dart Frog replay exercised cancelling its ability menu, choosing blue mana, reopening the tapped creature and paying for its separate deathtouch ability. Mana production did not use the stack; the other ability did. The inspector now displays gained keywords after resolution.

Second Burial demonstrates graveyard play. In the shipped reanimation position, Zombify can target Sire of Seven Deaths in its owner's graveyard. The graveyard chooser can be dismissed and reopened without casting; selecting the card pays the spell's mana cost and puts it on the stack. The card returns only after both players pass. Earlier QA matches are preserved as replay exports before replacing preview state.

## Deck room and construction

All 13 starter decks are available in the deck room. Choose the opponent independently, including mirror matches. The starters are exploratory lists, not tournament or format recommendations.

Customize a starter or build a fresh list. The visual builder has card/rules search, color and type filters, click/drag-to-add, quantity controls, live mana curve and validation. Basic lands can exceed four copies; other cards cannot. Lists remain bounded at 250 cards.

Save personal lists locally, export plain-text Arena-style lists, or import main decks. Unsupported cards stay visible in imported drafts, and block playing until removed or supported. Syntax errors and sideboards are rejected rather than silently discarded. Drafts are recoverable from the deck room after a reload. Browser storage is not cloud synchronization; export important lists.

The table uses bounded layout tracks for priority controls, separate art and live-stat overlays, and physical tap rotations. Reduced-motion preferences still apply to all game animations. Deck editing does not change a match already in progress; starting a replacement match requires a separate confirmation.

## Priority policy and Arena reference

The rules engine always retains normal priority. The client chooses when to send a pass, separately from rule resolution.

- **Smart play:** holds on your main phases, meaningful opposing response windows and explicit decisions; skips empty windows and most responses to your own effects.
- **Full control (F):** no automated priority passes or automated choice shortcuts. Opponent actions still proceed normally.
- **Phase stops:** click a phase for the current side, or use Stops to select a step on either player's next matching turn. Stops override passing modes and are consumed by a manual pass there. Setting a stop cancels and rechecks the pending timer.
- **Pass until response (Enter):** yields until a new opposing stack entry, a stop, a required decision or the turn boundary. **Pass turn (Shift+Enter)** also yields through opposing responses, but never silently chooses targets, attacks, blocks or discards. Cancel either mode with its visible Stop control or Escape.
- **Space:** the contextual next/resolve action. Double-click an untargeted hand card to play it; click a targeted card to enter target selection directly. Dragging onto a legal target still works, and dropping onto the table first can start target selection without paying costs.
- **Presentation:** the bot and automated passing wait for readable cast/resolution intervals. Manual responses are not replaced by animation outcomes. Reduced motion disables the visual movement, not rules.

Wizards describes Arena as skipping common low-activity windows and adding card-specific smart-priority exceptions; it also documents expanding hands and drag-to-cast interaction. Those inform this client's design, not a claim of Arena parity. Leyline has not implemented every Arena exception or shortcut. Sources: [Wizards smart-priority guide](https://magic.wizards.com/en/news/mtg-arena/announcements-october-27-2025), [Wizards interface overview](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21).

## Width-aware hands

The hand chooses a fan only when its measured width leaves a usable exposed strip on every card. Otherwise it becomes a horizontally scrollable rail. The arena uses an explicit zero-minimum grid column so intrinsic card widths cannot stretch the whole board beyond the viewport. Both hand modes use the same horizontal padding to avoid resize oscillation.

Narrow-screen hand controls have 44px hit areas without shrinking the card faces. Read card opens a read-only dialog for a current card in the viewing player's hand. Closing it preserves any pending target choice. Selection restores the rail's scroll position; switching hand size keeps the inspected card in view.

Chromium checks covered 1180, 768, 376 and 320 CSS-pixel widths, seven-card and twelve-card hands, reaching the last card, compact/expanded switching and keyboard Enter/Escape for inspection. A real Shock targeting flow was preserved across inspection, then paid and placed on the stack against the opponent. Native pointer dragging moved a Mountain from hand to the battlefield exactly once and cleared the drag state. These are desktop-browser responsive checks, not physical iOS or Android certification; the gesture tests separately cover horizontal touch-scroll intent and drag cancellation.

## Mobile match table

The mobile table fits the dynamic viewport and safe areas. Navigation moves into the table menu; phase stops, public zones, priority settings and history remain available there. Short landscape screens keep the primary action and a Read button visible. Empty hands collapse rather than reserving a blank card area.

Hold a visible battlefield card or a card in your own hand for 450 ms to open its reader. Moving, scrolling, cancelling or removing the source cancels the hold. Inspection never plays the card, reveals an opposing hand, or replaces a pending target choice. Card dialogs keep their close/actions fixed while long content scrolls. Hover previews are mouse/keyboard only.

Mobile battlefield tiles use artwork crops with live statistics, not tiny printed rules text. Full printed cards and rules remain in the reader. The power/toughness badge cannot be displaced by a long keyword label. Crowded rows scroll horizontally.

Cloud Chromium checks covered narrow portrait and short landscape windows, crowded replay positions, battlefield/hand inspection, table menus, and a Shock target choice preserved across reading and then committed with payment. Gesture unit tests cover touch-scroll cancellation separately. These are not physical iPhone Safari or Android tests, and do not certify native-device polish.

## Library-search picker

A pending library search opens a scrollable, name-grouped picker. Choose copies, remove selections, read the full card without losing selections, and confirm to find cards and shuffle. Top-of-library selections have explicit ordering controls. Review table closes the dialog without resolving or cancelling the pending choice. Engine validation remains authoritative.

The Engine page includes a real seeded search replay. Continue it to make the search choice yourself. This is not a fabricated board state.
