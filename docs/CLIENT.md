# The tabletop client

The UI submits the same commands as the CLI and simulation policies. Dragging never moves a card in engine state until a legal command is accepted.

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
