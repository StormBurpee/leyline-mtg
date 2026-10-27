# Power-damage Standard source review

Review baseline: `8faa094`, Standard inventory snapshot `standard-2026-10-26`, reviewed October 27, 2026. Exact supplied Oracle inventory rows (including source links and inventory checksum) are preserved in `tests/fixtures/power-damage-oracle-reviewed.json`. No Oracle clauses were omitted.

## Complete additions

| Card                  | Full supported behavior                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bite Down             | Own creature deals its current power to opposing creature **or planeswalker**, instant timing.                                                                      |
| Hard-Hitting Question | Same target and damage semantics, sorcery timing and printed one-green cost.                                                                                        |
| Hivespine Wolverine   | All three ETB modes: counter on own creature; nontargeted source fights a creature token of either controller; destroy artifact/enchantment.                        |
| Affectionate Indrik   | Required opposing creature target chosen on announcement, optional source fight chosen at resolution.                                                               |
| Flourishing Grapple   | Opposing red/white creature-or-planeswalker loses abilities first, then own targeted creature bites that permanent. A lost actor does not suppress ability removal. |
| Mind Meanderer        | Flying; continuous vigilance only with a controlled Jace planeswalker; source fights up to one opposing creature on entry.                                          |
| Burrog Barrage        | Conditional +1/+0 after another own instant/sorcery was cast this turn; then bite up to one opposing creature. A zero-victim cast can still pump.                   |

The source/binding foundation is documented in [power-damage-bindings.md](power-damage-bindings.md). Tests preserve complete Oracle text, source identities, all modes, conditional/optional clauses, legal target selection and deterministic command replay. Real cards are tested through casting/trigger/choice paths, not only by directly invoking effects.

## Remaining inventory scan

All 55 previously unimplemented cards whose Oracle text mentions fighting or damage equal to their power were scanned. The reusable binding is not a claim that unrelated clauses are implemented:

- **Coordinated with other lanes:** Agatha's Champion requires the Bargain lane and uses the shared source-fight binding. Pitiless Fists and Yoshimaru, Scrappy Stray use existing attached/grouped fight and are assigned to the M–Z source lane. Run Over was handed to that lane for its supported target-filtered reducer.
- **Doubling or a different damage quantity/source:** Polliwallop, Punishing Punch, Chocobo Kick, Compel Brutality, Dragonclaw Strike. `doublePower` alone does not double toughness, so it cannot implement Dragonclaw Strike. Compel Brutality also needs a planeswalker-loyalty damage source, not a creature-power approximation.
- **Choose-many modes:** Brigid's Command, Clash of the Eikons, Epic Fight. Epic Fight additionally doubles both power and toughness.
- **Different source iteration or recipients:** Bartz and Boko (each other Bird source), Champion of the Path (event-source power and its other behold/exile clauses), Nibelheim Aflame and Waltz of Rage (one creature damages each other creature, plus additional clauses), Pain for All (attached source damage and damage-reflection trigger).
- **Target-object state or distinct follow-through:** Malamet Battle Glyph, Throw from the Saddle, Wisecrack, Beastie Beatdown, The Last Agni Kai, Rhino's Rampage. These require target-specific conditions, delirium, or damage/excess-damage outcomes that are not supplied by this binding change.
- **Reflexive, delayed, attachment or selection continuations:** Curse of the Werefox, Faunsbane Troll, Feral Encounter, Itzquinth, Firstborn of Gishath, Earth Rumble, Novel Nunchaku, Thorin, Mountain-king, Dire Flail // Dire Blunderbuss. Their additional Role, craft, linked-return or sacrifice/attachment clauses must also remain intact.
- **Other independent mechanics/costs:** Abomination, Terrifying Titan (power-up hybrid reduction), Bite Down on Crime (collect evidence), Blazing Bomb (cast mana-spent condition), Callous Sell-Sword // Burn Together (death-count entry and any-other-target sacrifice sequence), Go Nuts! and HULK SMASH! (teamwork), Hunter's Talent (Class levels), Infernal Phantom (Eerie/fully unlocked Rooms), Longstalk Brawl (gift branch), Osseous Sticktwister (delirium and opponent choice/payment outcome), Piercing Exhale (casting-time behold), Rust Harvester (artifact-card exile activation payment), The Super Hero Civil War (control-duration/total mana-value targets), Wolverine, Fierce Fighter (damage replacement healing).
- **Conditional search and complex transform sequences:** Archdruid's Charm (search result determines destination), Clive, Ifrit's Dominant // Ifrit, Warden of Inferno (optional discard/devotion draw and repeated transformation through Saga chapters).
- **Textual false positive:** Food Fight is not creature-power damage; its name appears in a dynamic permanent-count damage ability.

This is a lane-specific review, not an update of the global support inventories. Cards in other lanes may cease to be blocked after their own full mechanics land.
