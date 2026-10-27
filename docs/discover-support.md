# Discover resolution and complete Standard cards

## Rules contract

Reviewed against the local Comprehensive Rules snapshot effective **September 25, 2026** ([official document](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)), particularly CR **701.57**, 118.9, 202.3, 601.2, 608.2, and 400.7, and the [Lost Caverns of Ixalan release notes](https://magic.wizards.com/en/news/feature/the-lost-caverns-of-ixalan-release-notes), last modified November 7, 2023. Card identities, complete text, and characteristics use the October 26, 2026 local Standard inventory (`research/standard-expansion/standard.json`).

- Source/native `{ "op": "discover", "amount": N }` accepts an integer from 0 through 1000. This is a bounded literal instruction, not a search, draw, look-at-top selection, or temporary exile-play permission. Unknown fields and unresolved numeric bindings are rejected by both source compilation and native registry validation.
- The resolving effect's controller exiles cards face up, in library order, until a nonland card with printed mana value at most N is found. Both players can see every exiled card. An empty or exhausted library causes no failed draw and does not strand the rejected cards in exile.
- The found card uses the existing resolution-time `castExiled` decision with a `discover` value. The player either casts the card without paying its mana cost or puts it into its owner's hand. A card that lacks legal targets or payable mandatory costs is not skipped; putting it into hand remains available. The choice grants no ordinary exile-play permission and no land play.
- Casting validates the **resulting spell's** printed mana value independently from the exiled card's eligibility. Thus an expensive Adventure cannot be cast under a smaller Discover value even when its main face qualified, and a cheap Adventure cannot qualify an expensive main face. Existing transforming cards use their front face in the library and exile; Discover does not grant permission to cast their reverse face. Split/MDFC casting is not newly implemented by this foundation.
- Discover supplies an alternative cost. Disguise and warp alternatives cannot replace it, and X must be explicitly 0 when the printed mana cost contains X. Kicker, offspring, Spree mode costs, mandatory sacrifice/discard/life costs, optional bargain, and ordinary cost increases/reductions continue through normal casting and payment. Additional costs never inflate the printed mana-value limit.
- The remainder is returned to the bottom in seeded random order, without shuffling the unexamined portion of the library. References include incarnations; another object that reused a card ID is never pulled back from exile. The completed action emits a `discovered` log event only after the remainder is processed. This log entry does not implement a new general triggered-event family.
- Discover reuses the existing parent-resolution continuation. Targets and costs are chosen during the parent effect; no priority window opens. Cast triggers wait until that resolution finishes. Linked permanent/Aura returns caused by casting costs may pause payment without losing the parent, remaining exiled cards, or subsequent instructions. Repeated Discover instructions can each pause within the same parent resolution.
- Replay state carries the pending decision and remainder references; opaque-agent observations see public exile objects but not concealed library identities or order. After bottoming, public views again conceal those library objects. The bot uses the ordinary legal-cast proposals, otherwise choosing hand.

Previously the compiler/registry rejected Discover, and Chandra's immediate-cast choice could only decline for damage. The extension preserves Chandra's paid casting and damage outcome. The web dialog distinguishes free cast/hand from Chandra's choice, constrains the X dialog to 0, and retains the legal-target list and cancel controls during resolution casting instead of replacing them with the generic review button.

## Complete card additions

| Card                    | Full supported clauses                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Hidden Cataract         | Cave; enters tapped; blue mana; `{4}{U}`, tap and sacrifice, sorcery-only Discover 4                                  |
| Hidden Courtyard        | Cave; enters tapped; white mana; `{4}{W}`, tap and sacrifice, sorcery-only Discover 4                                 |
| Hidden Necropolis       | Cave; enters tapped; black mana; `{4}{B}`, tap and sacrifice, sorcery-only Discover 4                                 |
| Hidden Nursery          | Cave; enters tapped; green mana; `{4}{G}`, tap and sacrifice, sorcery-only Discover 4                                 |
| Hidden Volcano          | Cave; enters tapped; red mana; `{4}{R}`, tap and sacrifice, sorcery-only Discover 4                                   |
| Buried Treasure         | Artifact Treasure; tap/sacrifice for any color; `{5}` and exile itself from its graveyard for sorcery-only Discover 5 |
| Geological Appraiser    | 3/2 Human Artificer; entry Discover 3 only if its controller cast it                                                  |
| Daring Discovery        | Up to three target creatures cannot block this turn, then Discover 4                                                  |
| Etali's Favor           | Enchant creature you control; entry Discover 3; enchanted creature gets +1/+1 and trample                             |
| Primordial Gnawer       | 5/2 Insect Horror; self battlefield-to-graveyard trigger discovers 3, including after type changes                    |
| Walk with the Ancestors | Return up to one target permanent card from your graveyard to hand, then Discover 4                                   |

For Daring Discovery and Walk with the Ancestors, choosing zero targets still allows discovery. If all chosen targets are illegal on resolution, the spell does not resolve and does not discover. No printed clauses are omitted.

## Inventory boundaries

The broader Standard snapshot contains **22** cards whose text (including reverse faces) mentions Discover. The other eleven remain unadmitted, rather than approximating their additional clauses:

| Deferred card                                        | Additional unsupported contract                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Brass's Tunnel-Grinder // Tecutlan, the Searing Rift | Descended/bore transformation and mana-source-linked casting event with a captured mana value              |
| Caparocti Sunborn                                    | Optional simultaneous tap-two artifact/creature payment during an attack trigger                           |
| Chimil, the Inner Sun                                | Continuous uncounterability of all controlled spells                                                       |
| Curator of Sun's Creation                            | Once-per-turn discover-event trigger carrying the previous Discover value                                  |
| Digsite Conservator                                  | Up to four graveyard targets constrained to one graveyard, plus optional mana payment on its death trigger |
| Hit the Mother Lode                                  | Post-Discover remembered-card mana value and the corresponding tapped Treasure count                       |
| Hurl into History                                    | Discover amount bound to the targeted spell's captured mana value, including counter failure               |
| Quintorius Kand                                      | Cast-from-exile event filtering and its complete multi-card exile/mana/play ultimate                       |
| Swashbuckler's Whip                                  | Equipment granting activated abilities to the equipped creature                                            |
| Trumpeting Carnosaur                                 | Its self-discard activated damage ability from hand                                                        |
| Zoetic Glyph                                         | Continuous attached-artifact creature/type/base-stat conversion                                            |

These exclusions are scoped to this addition, not claims that those mechanics cannot be built next. Dynamic Discover amounts and discover-trigger listeners are explicitly outside this literal foundation.

## Verification

- `tests/discover.test.js` compiles all eleven actual sources into a dedicated catalog rather than depending on generated artifacts. It covers schema/native round trips, full Oracle identity, empty/no-match libraries, deterministic bottom order, public/private views, illegal-command atomicity, required targets, Adventure/front-face restrictions, zero-X casting, retained mandatory and optional costs, taxes, cast triggers, source removal/control/incarnations, linked Aura payment pauses, sequential discovery, and each printed card clause. Actual Appraiser games are checked through mid-choice command replay and a finished opaque-agent simulation.
- `tests/discover-ui.test.js` exercises the real client through DOM lifecycle tests: saved pending Discover, free-cast/hand wording, legal-target-list access, cancel/reopen, repeated stale clicks, and the zero-only X dialog.
- `tests/types/discover.ts` checks the public opcode, distinct Chandra/Discover choice outcomes, and persisted remainder references.
- Existing Chandra, casting-cost, additional-cost, X, Adventure behavior, and warp regressions are run as focused tests with `--test-concurrency=1`.

The v0.55 integration refreshes generated catalogs, support manifests and dated coverage inventories alongside the other admitted mechanic families. DOM tests are not visual browser QA; managed preview remains unavailable, and no manual browser/server workaround is used.
