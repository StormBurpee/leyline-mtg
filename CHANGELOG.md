# Changelog

## 0.36.0 — Stun counters

- Apply stun-counter replacement to normal, explicit and group untaps. Consume only one counter per actual untap event; leave counters on already untapped permanents and when another effect skips untapping. Clear counters on zone changes.
- Support entering with stun counters and targeted/source/group counter placement. Show stun counts in card inspection and score grouped tempo spells in the bot.
- Add 11 complete Standard cards, including Sleep-Cursed Faerie, Out Cold, Ambling Stormshell and Succumb to the Cold. Catalog: 1061 cards and 27 tokens.

## 0.35.0 — Grouped targets and creature fights

- Add ordered target groups with cardinality, distinctness and cross-group exclusions. Check legality per target at resolution, resolve partially legal spells and trigger ward once per targeted permanent.
- Add simultaneous creature fight/bite damage and grouped synchronous effects. Preserve pre-batch source facts during simultaneous departures.
- Add large staged target selection with Read, Back and guarded confirmation, plus bounded bot target-plan proposals and profitable fight/bite evaluation.
- Add 14 full-text Standard cards. Catalog: 1050 cards and 27 tokens. Grouped targets currently cover nonmodal instants/sorceries without kicker; triggered/activated groups and pausable group-bound effects remain unsupported.

## 0.34.0 — Casting-cost reductions and taxes

- Determine casting costs from intrinsic and battlefield modifiers, including stable conditions, target predicates and public counts. Add increases before reductions, preserve coloured requirements, and lock the result before payment.
- Compute costs with the proposed spell removed from its prior zone. Keep printed mana value for cast triggers, including kicker and discounted spells. A permitted spell is controlled by its caster on the stack.
- Add 41 complete Standard cards, including affinity spells, Tolarian Terror, Mocking Sprite and target-dependent discounted removal. Catalog: 1036 cards and 27 tokens.
- Activation-cost changes, minimum-cost replacement rules, dynamic coloured reductions and unimplemented clauses remain rejected.

## 0.33.0 — Conditional continuous bonuses

- Add self and attached continuous bonuses with public comparisons, turn ownership, source attacking/entry-turn state, and stable controlled-permanent conditions. Avoid evaluating unnecessary derived facts and reject dependency cycles.
- Add 21 full-text Standard cards, including Goblin Tomb Raider, Twinblade Paladin, Knife and Shardmage’s Rescue. Catalog: 995 cards and 27 tokens.
- Keep combat membership until the end-of-combat step ends. Exclude tokens temporarily outside the battlefield from card counts.
- Conditional casting permissions, spell-count history and unsupported card clauses remain rejected.

## 0.32.0 — State-derived values and creature statistics

- Add bounded, data-only numeric expressions for public zone counts, life totals, sums and scaling. Resolve instruction values at resolution and continuous bonuses against live state. Hidden zones expose counts only, not characteristic queries.
- Add characteristic-defining creature statistics in every zone, source bonuses and scaling Aura/anthem bonuses. Library searches use derived characteristics; fixed 1/1 offspring exceptions omit copied power/toughness-defining abilities.
- Add 26 full-text Standard cards and one Gremlin token definition. Catalog: 974 cards and 27 tokens. Includes Regal Bunnicorn, Enigma Drake, Ethereal Armor, Blanchwood Armor and Rumbling Rockslide.
- Cast-time X selection, dependent-characteristic count filters and dynamic mana production remain unsupported. A token-creation instruction retains the 1,000-token resource ceiling.

## 0.31.0 — Creature Auras and attachment choices

- Add fixed creature Aura stat/keyword bonuses, attached-subject effects, no-untap restrictions and legal-attachment state-based checks without incorrectly treating hexproof as an ongoing enchant restriction.
- Noncast Aura entry uses explicit, non-targeting attachment choices and retains simultaneous-entry choices and resolution continuation. Choices use the shared large-card UI.
- Preserve last-known attached permanents for pending abilities when their source leaves. Keep library-search entry choices rather than discarding them.
- Add sixteen full-text Standard Auras. Catalog: 948 cards and 26 tokens. Control-changing Auras, dynamic bonuses, ability removal and other unimplemented clauses remain rejected.

## 0.30.0 — Equipment foundation

- Add Equip using normal activated abilities, costs, sorcery timing, targeting, stack resolution and zone-incarnation checks. Support typed equip and literal alternative discard costs.
- Apply equipped power/toughness and keyword bonuses continuously. Equipment survives wearer departures, becomes unattached when illegal, and keeps its own controller.
- Add 22 complete Standard Equipment cards, including Basilisk Collar, Swiftfoot Boots, Sword of Vengeance, Celestial Armor and Gold Pan. The bot can cast and equip these cards without repetitive re-equip loops.
- Catalog: 932 cards and 26 tokens. Granted activated/triggered abilities, dynamic Equipment bonuses, living weapon, reconfigure and other unimplemented clauses remain rejected.

## 0.29.0 — Life-gain triggers

- Implement positive life-gain events, including lifelink batching by damage source. Separate sources trigger separately; split damage from one source triggers once. Zero gain does not trigger.
- Add twelve full-text Standard cards, including Ajani’s Pridemate, Marauding Blight-Priest, Starscape Cleric, Minwu and Drogskol Reaver.
- Isolate pending trigger queues in bot life-payoff scoring so evaluating a hypothetical gain cannot modify the match.
- Catalog: 910 cards and 26 tokens. Broader life replacement, dynamic amounts and dependent card mechanics remain unsupported.

## 0.28.0 — Combat-role targeting and Standard removal

- Add blocking predicates alongside attacking predicates, using current combat membership and zone incarnations for targeting, group effects and trigger facts.
- Add Beyond the Quiet, Cosmium Blast, Daring Mechanic, Gravkill, Joust Through, Radiant Strike, Repel Calamity and Sudden Strike with full rules text.
- Catalog: 898 cards and 26 tokens. Standard coverage: 680/5,164. Unsupported dependent-characteristic anthems remain rejected.

## 0.27.1 — Reachable card choices at every width

- Keep wide card galleries start-aligned when they overflow, so the first mulligan cards remain reachable on intermediate-width screens.
- Preserve explicit Read card controls in short landscape layouts rather than hiding the only full-text reader entry point.
- This is a structural CSS correction; native browser layout validation remains unverified.

## 0.24.0 — Standard expansion and bot integration

- Add 280 complete-match Standard card definitions from a strict, fail-closed authoring pass, plus 21 token definitions. The catalog now contains 797 playable cards and 24 tokens; dated coverage is 579/5,164 Standard and 785/15,332 non-Alchemy Arena.
- Add filtered group effects, step triggers, cycling, sacrificing mana sources, stable filtered anthems, combat restrictions and sorcery-speed activated abilities. Unknown clauses remain unsupported rather than being dropped.
- Integrate the bot planning/hand-selection/combat improvements from PR #13, preserving modal routing and benchmark limitations. No claim of human-level play.
- Preserve the exact requested Rakdos list as the default deck selection. It is visibly locked while its missing mechanics are implemented; there are no substitutions.
- Browser preview remains unavailable; this checkpoint has no new browser or physical-mobile validation.

## 0.23.0 — Choose your line

- Implement choose-one instant/sorcery modes at cast time, with mode-specific legal targets/effects, normal cost payment and public stack labels. Preserve mode indices through opaque agent commands and replays.
- Add a deliberate mode picker, disabled unavailable modes, mode-filtered target lists, change-mode controls and mode-safe dragging. Add Forked Lightning as the sixteenth starter and an Abrade replay position.
- Add 28 reviewed Arena spells, eleven in the dated Standard inventory: 517 executable cards plus three tokens. Support keyword predicates, targeted +1/+1 counters and keyword-only temporary modifiers on noncreature permanents.
- Correct missing printed subtypes on 41 early card definitions and three generated tokens. Keep the original v0.5 contract hashes, explicitly review the subtype-only exceptions, and preserve all twenty historical game-command traces.
- Multi-mode choices, modal abilities and general multi-target spells remain unsupported. Managed browser preview is unavailable; renderer/drag-plan/engine/replay tests are not a substitute for browser or physical mobile QA.

## 0.22.0 — Attacks before blockers

- Queue declared-attacker triggers before priority, with APNAP ordering, targeted-trigger choices and existing resolution continuations. Entering attacking is not a declared attack.
- Add attacking/legendary card predicates and targeted permanent untapping, with zone-incarnation and resolution-time target checks.
- Add 22 reviewed Arena cards, eight in the dated Standard inventory: 489 executable cards and three tokens. Add First Blood as the fifteenth starter and an attack-trigger replay.
- Forecast mandatory, untargeted public-board attack life effects and nonnegative self modifications in the bounded sparring policy. Omit mixed draw/search/targeted abilities whole rather than inventing hidden information. Improve untap target selection.
- Preserve full legacy traces and rerun the pinned Forge inventory. General attack costs/restrictions, attacks-or-blocks triggers, dynamic X values, extra combats and entering-attacking effects remain unsupported.
- Managed browser preview remained unavailable after an environment recovery and one retry. No new browser/mobile validation is claimed.

## 0.21.0 — One legend stays

- Implement the legend rule for legendary permanents: controller choices before priority, APNAP sequencing, simultaneous state-based departures, and correctly retained enters/death triggers.
- Add Isamaru, Hound of Konda; Yargle, Glutton of Urborg; Yargle and Multani; and Zetalpa, Primal Dawn. Four Arena cards, two in the dated Standard inventory; 467 executable cards and three tokens total.
- Add explicit keep/read controls, live copy statistics and a replayable legend-rule example. Bot and opaque simulation handles use the same validated choice command.
- Reject legendary instants/sorceries until their additional casting restrictions are implemented. No claim of general legend-related exceptions or copy effects.
- Browser QA for this checkpoint was unavailable because the managed preview timed out. Engine, renderer, schema, replay and aggregate checks are recorded separately.

## 0.20.0 — Find the card you need

- Add reusable, schema-checked own-library search with legal quantity choices, printed-characteristic filters, deterministic shuffle and hand/graveyard/battlefield/top destinations. Preserve fail-to-find, explicit reveal and continued-resolution rules.
- Add 29 reviewed Arena card definitions, 25 in the dated Standard inventory, bringing the executable pool to 463 cards plus three tokens. Add Roots & Relics as the fourteenth starter and a real search replay.
- Add a touch-friendly library picker with grouped copies, read-only inspection, selected-card removal and top-order controls.
- Route search choices through the simulation agent boundary and teach the practice policy to use fetch/ramp abilities and choose missing colours.
- Replace hidden-zone IDs in the lower-level player view with non-identity placeholders; keep public departed-source references valid. Preserve the frozen legacy gameplay traces.
- Re-run the pinned 34,131-file Forge audit. Its 2,205 grammar candidates remain distinct from playable-card coverage; the adapter does not yet translate the new search instruction.

## 0.19.0 — A touch-first deck builder

- Switch between Browse cards and My deck on mobile instead of scrolling past a whole collection to edit the list. Keep search, deck count and save controls reachable.
- Separate reading from adding: tap card art or a deck-list name to inspect it, then use the explicit Add control to change the deck. Maximum-copy cards remain readable.
- Enlarge quantity controls, preserve panel scroll positions and keep desktop drag-to-list available.
- Preserve focus on the exact named control after rerendering rather than moving it to the first matching action.

## 0.18.1 — Readable mobile battlefields

- Use responsive artwork crops for compact mobile battlefield tiles; retain the full printed card on desktop and in the reader.
- Keep live power/toughness badges inside each tile instead of letting long keyword labels push them across neighbouring cards.
- Preserve useful tile width on crowded boards, with horizontal scrolling rather than microscopic cards. Reduce tapped-card rotation to avoid clipping.

## 0.18.0 — A table that fits your phone

- Keep the match, battlefield, hand and primary action within the dynamic viewport, including short landscape screens and safe-area insets.
- Reclaim empty-hand space; move navigation, public zones and priority settings into a touch-friendly table menu.
- Add compact phase and stack controls, keeping active stack targets linked to their objects.
- Hold any visible card to read it without playing it. Cancel inspection on movement, scroll, interruption or removal, and suppress delayed accidental clicks.
- Keep dialog headers and actions reachable while long card content scrolls. Restrict hover previews to mouse or keyboard, not touch.
- The rules engine remains 0.17.0. Phone-sized Chromium checks do not replace physical iOS or Android testing.

## 0.17.1 — Reachable hands

- Fit the playing surface to its container instead of allowing an implicit grid column to force horizontal overflow.
- Choose a fan or scrollable card rail from actual available width; keep every card reachable in normal and large hands.
- Add a read-only hand-card dialog that preserves pending targeting. Give narrow-screen hand controls 44px hit areas without shrinking card faces.
- Preserve the inspected card when switching hand size, retain scroll through selection, and hide stale previews while scrolling.
- Fix compact-hand sizing at intermediate screen widths. The rules engine remains 0.17.0.

## 0.17.0 — Purposeful combat tricks

- Compare supported modifier spells against the declared combat before spending a card: save a creature, improve a trade, prevent lethal or win now.
- Hold pure pump when it only adds nonlethal face damage or when combat already wins without it. Value surviving original permanents, not inflated temporary stats.
- Use toughness, indestructible or hexproof against individual known removal threats when the modifier actually changes the outcome. Toughness does not answer destroy removal.
- Enable useful targeted pump activations, including Wildheart Invoker, and distinguish spending mana from spending a card.
- Preserve blocked status after a blocker leaves: without trample, pumping the attacker does not make it unblocked.

## 0.16.0 — Mana development and removal discipline

- Choose land drops by immediate lethal, newly affordable plays and the colors required by the known hand instead of hand order.
- Prefer an untapped source when it enables a play; develop tapped fixing early when it does not delay one. This is a mana heuristic, not a full landfall/ETB forecast.
- Stop valuing damage or destroy effects as creature removal against indestructible. Bounce remains an option.
- Give nonlethal opponent-wide burn a pressure score, so cards such as Boltwave are not silently held until lethal.

## 0.15.0 — Combat death payoffs

- Include life-only death triggers in bounded attack and block evaluation, including Blood Artist and Zulaport Cutthroat.
- Resolve those payoffs through the real stack, APNAP order, legal player targets and last-known damage keywords, including between first-strike and normal damage.
- Preserve the rule that lethal combat damage ends the game before death-trigger lifegain can rescue a player.
- Expose omitted triggers and search-limit exhaustion rather than claiming full trigger-chain search. Draw, token and creature-targeted death effects remain outside this forecast.

## 0.14.0 — Safer AI decisions

- Evaluate ward using resources remaining after base payment.
- Avoid voluntary self-lethal life-loss and empty-library draw lines in known effect chains.
- Prefer immediate lethal over routine activations; deploy an already-castable landfall permanent before the land drop.
- Preserve cards during surveil when the same spell still has a draw to perform.
- Prefer safe trigger targets while retaining a legal fallback for mandatory choices.

These are bounded policy guards, not a complete forecast of every triggered interaction.

## 0.13.1 — Keyboard focus

- Escape now cancels click-targeting even while a card button has keyboard focus.
- Full-control and explicit pass-turn shortcuts work from focused controls without hijacking text input or ordinary button activation.
- Enter on an already selected hand card uses its play action.

## 0.13.0 — Read the table

- Larger expanded hands, adjacent full-card inspection, visible auto-payment previews and direct click-to-target.
- Targeted spells can be dropped onto the table before choosing a target; cast/ability targets have visible tethers and damage has source-to-target feedback.
- A contextual action button, explicit full control, one-shot phase stops, pass-until-response and pass-turn controls. Automation sends normal engine commands and rechecks stops at timer execution.
- Optional automatic trigger ordering and suggested damage; attacks, blocks, targets, discards and optional effects remain explicit choices.
- Public-board tactical combat search replaces the two-blocker menace shortcut. Attack subsets include a bounded defensive-response and crack-back check; tap abilities preserve necessary blockers, and cast-trigger threats receive sequencing consideration.
- Tactical evaluation uses the real combat damage kernel, but does not solve hidden information, future draws, combat tricks or full triggered-ability chains. This remains a sparring bot, not a competitive benchmark.
- Replays from v0.10 and v0.11 are accepted again. Legacy trace regression uses a frozen policy rather than requiring new AI to repeat old mistakes.

## 0.12.0 — Last Rites

- Death triggers use pre-event characteristics and controllers, including simultaneous creature deaths and tokens.
- Activated abilities can sacrifice their source as a cost. Costs are paid immediately; the ability remains on the stack independently of its source.
- Added 88 reviewed definitions, including Blood Artist, Zulaport Cutthroat, Mind Stone, Cathar Commando, Fanatical Firebrand and Doomed Necromancer.
- Added Last Rites, an introductory black/red death-trigger and self-sacrifice deck.
- The practice policy can use graveyard-return and removal sacrifice abilities, while avoiding immediately cashing in early mana rocks.
- Torch Courier was not admitted: its Forge selector does not encode the Oracle “another” restriction in the supported target grammar. Compiler recognition alone is not executable support.

434 executable cards plus three tokens. This does not add arbitrary sacrifice outlets, sacrifice additional spell costs, death replacements or once-per-turn triggers.

## 0.11.0 — The deck room

- Rebuilt the lobby as an art-led deck library with all 12 starter lists and independent opponent selection.
- Added a visual deck builder: card search, color/type filters, drag-to-add, copy controls, mana curve, local saves, draft recovery and list export.
- Imports can retain unsupported cards as visibly incomplete drafts; incomplete lists cannot start a game.
- Reworked the tabletop with printed card silhouettes, live-stat overlays, stronger tap states and explicit layout tracks that keep match controls visible.
- Added nine new 60-card introductory lists. These are executable demonstrations, not format-certified or competitive lists.
- Fixed importing more than four copies of an unsupported card throwing instead of returning validation errors.

## 0.10.0 — Graveyard play and a third deck

- Graveyard targeting, recovery, reanimation and exile removal.
- Life loss is distinct from damage; draw/discard/life effects can affect another player without granting priority during resolution.
- Added 67 reviewed cards, including Zombify, Eternal Witness, Siege Rhino, Burglar Rat, Regrowth and Sign in Blood.
- Added Second Burial, a 60-card introductory reanimation deck, and a playable showcase position.
- Graveyard target menus and drag-target trays; card motion starts from the graveyard counter.
- Ward and hexproof do not incorrectly protect cards in graveyards.

346 executable cards plus three tokens. The dated inventories contain 231 executable Standard cards and 334 non-Alchemy Arena cards; full coverage remains open.

## 0.9.0 — Reviewed Standard expansion

- Added 145 reviewed Standard source definitions, including spells, creatures, gain lands, scry lands and mana/filtering abilities.
- Independent Oracle identity/characteristic checks and pinned Forge provenance for every addition.
- Per-card casting/payment/resolution tests, mana-option and ability tests, and five mixed-deck simulation matchups.
- Fixed summoning sickness expiring at the opponent's turn boundary; readiness now follows the controller's most recent turn start.
- Permanents with both mana and other activated abilities expose both in the client.
- Live characteristics display granted keywords, not only printed ones.

279 executable cards plus three tokens. The dated Standard inventory has 212 executable definitions out of 5,164; this remains a small subset, not complete Standard support.

## 0.8.0 — Targeted triggered abilities

- Required trigger targets are chosen during stack placement, preserving APNAP and same-controller ordering.
- Missing legal targets remove the trigger; invalid and stale target choices reject atomically.
- Targeted triggers interact with ward, optional resolution and source last-known information.
- Eight reviewed source definitions, including Reclamation Sage, Meteor Golem and Exclusion Mage; 134 executable cards total.
- Explicit legal target-choice actions for simulation policies, with opaque object handles and private continuations.
- Departed trigger sources retain opaque incarnation-bound references rather than leaking concealed raw object IDs.
- Browser highlights and a target-list alternative, plus a reproducible replay paused at the new decision.
- Conservative Forge translation for targeted DB trigger roots; nested additional targets still reject.

Multi-target, modal, delayed/reflexive and general leave-the-battlefield triggers remain unsupported.

## 0.7.0 — Direct manipulation at the table

- Drag cards from hand to the battlefield, players, permanents or spells on the stack.
- Legal drop zones come from the engine, with revision checks at submission.
- Drag to select attackers and assign blockers; confirm the complete group separately.
- Targeting tethers, compact spell-target trays, combat links and cancelled-drag returns.
- State-driven card movement, tap transitions, graveyard departures and life changes.
- Saved reduced-motion preference, keyboard/click alternatives and stable scroll positions.
- Added a reproducible interactive position and gesture/command-boundary regression tests.

This is a client release. The rules package and core card pack remain at 0.6.0; executable coverage remains 126 cards and three tokens.

## 0.6.0 — Versioned card sources

- Replaced the hand-written JavaScript card list with one schema-versioned JSON file per card.
- Added bounded data-only mechanic templates, stable identities and all-or-nothing compilation/linking.
- Generated runtime data is checked against source in CI; all 129 v0.5 definition contracts are preserved.
- Replaced closed target/event categories with composable predicates, retaining legacy compatibility.
- Added schema validation and tests for unknown instructions, bad references, malformed data and cyclic templates.
- Separated runtime-definition validation from catalog loading, so source compilation can bootstrap cleanly.
- Corrected battlefield Anthem bonuses incorrectly affecting creature cards/spells outside the battlefield.

The core pack remains 126 cards plus three tokens. This is an authoring/runtime architecture milestone, not full Arena coverage.

## 0.5.0 — Multiple card types and optional abilities

- Artifact creatures and enchantment creatures retain both printed type categories.
- Artifact-, enchantment- and creature-cast triggers use the complete type set.
- Optional triggered effects pause for a real accept/decline decision at resolution.
- Artifact/enchantment targeting, removal and permanent bounce.
- Five-color mana artifacts and artifact creatures respect tap costs and summoning sickness.
- Fourteen additional executable cards; 126 cards total.
- Registry validation rejects fields that would otherwise be ignored on the wrong card type.
- Migration reports fingerprint the compiler and its validation/type dependencies.

Land-creature combinations, type-changing continuous effects and full format coverage remain unsupported.

## 0.4.0 — Trigger migration and flexible mana

- Strict Forge translation for selected enters-the-battlefield, cast and landfall triggers.
- Land entry uses the common event path, with explicit trigger ordering.
- Flexible single-mana sources use matching rather than a greedy colored-cost assignment.
- Manual color choices, unconditional tapped entry and the ten life-gain dual lands.
- Milling, three landfall creatures and three milling cards; 112 executable cards total.
- CI-gated annotated version tags, with immutable backfilled checkpoints.

General replacement ordering, broader triggers and full Standard/Arena coverage remain open.

## 0.3.0 — Simulation boundary and card-pool tracking

- Headless sessions with immutable, player-specific observations and opaque card handles.
- Async policy callbacks, deterministic episode logs and explicit failure/truncation outcomes.
- Dated Standard and non-Alchemy Arena inventories, with per-card implementation status.
- Menace block validation and ward with mana/life payment choices.
- Shared atomic mana, life and tap cost handling; no double-tapping a mana source to pay its own tap cost.
- 34 reviewed single-face Standard creatures and six ward creatures; 96 executable cards total.
- Damage source characteristics use current information or departure-time last-known information.
- Registry and command validation hardening, plus source-limited observations for larger catalogs.

Full Standard, Arena and Forge parity remain open. Card inventory is not executable coverage.

## 0.2.0 — Registry and resolution foundations

- Validated, immutable per-game card catalogs, preserved in replays.
- Resolution continuations for scry, surveil and mandatory discard choices.
- Opt, Preordain, Consider, Catalog, Careful Study and Merfolk Looter.
- Replay branching into local hotseat play, without editing the original record.
- Conservative Forge-script migration auditing and a pinned upstream inventory.
- Cross-platform checks and local-server asset-boundary tests.

Still a development preview. No full Forge parity, general layers, replacement pipeline, Commander or network play is claimed. See the parity tracker for open work.

## 0.1.0 — First playable kernel

- Deterministic commands, priority, stack, mana and two-player turn structure.
- Combat assignments, supported keywords, triggers and state-based actions.
- Modern tabletop, card inspection, deck import, local saves and replay.
- Initial curated card pool and an inspectable heuristic opponent.
