# Explicit source-bound fight and power damage

Rules reference: [Comprehensive Rules, effective June 19, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf), CR 608.2b/h, 701.14a–d, 120.3, 702.2 and 702.15.

`fight` and `bite` accept exactly one of `sourceGroup: "actor"` (one required creature target) or `source: "source"` (the ability's nontargeted source), together with a declared `victimGroup`. This is not a second target declaration for the source. Both the JSON Schema and native validator reject omitted, unknown and ambiguous source bindings.

Fight still requires one creature victim. Both combatants must be current battlefield creatures with their original incarnations; missing, illegal, noncreature and returned objects do not fight. Powers and damage-source keywords are captured before the simultaneous damage batch. Self-fight deals one packet of twice the creature's nonnegative power.

Bite permits creature-or-planeswalker permanent victims, never arbitrary permanents or players. A targeted actor must remain a legal current creature. A nontargeted ability source instead uses its current power or the existing departure snapshot, including its last controller and keywords. A returned incarnation is never substituted for that source.

Both operations use the shared damage pipeline: supported damage bonuses, loyalty loss, deathtouch and lifelink remain intact. This does **not** introduce generic protection or damage prevention, which the baseline engine does not implement. Existing prevention-denial rules remain shared with other damage effects.

Focused schema, compiler, native-validator, runtime and replay tests cover these boundaries. Existing grouped fight/bite definitions retain their original representation.
