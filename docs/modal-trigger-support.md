# Choose-one triggered modes

Rules reference: [Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), especially 603.3b–d, 700.2 and 117.5.

A modal triggered ability chooses its mode **when it is put on the stack**, not when it resolves. Pending abilities first survive state-based actions and controller/APNAP ordering. Each then asks for one legal mode, followed by that mode's target declaration. Neither player receives priority between these decisions. Opponents can respond after all announcements finish.

## Data and command contract

```json
{
  "kind": "triggered",
  "on": { "event": "enter", "object": "source" },
  "choose": 1,
  "modes": [
    {
      "label": "Gain 3 life",
      "effects": [{ "op": "gainLife", "target": "controller", "amount": 3 }]
    },
    {
      "label": "Destroy target artifact",
      "target": { "scope": "permanent", "where": { "type": "artifact" } },
      "effects": [{ "op": "destroy", "target": "target" }]
    }
  ]
}
```

Native triggers use `modes` instead of shared `effects`, `target` or `targetGroups`. A `triggerMode` decision exposes legal zero-based mode indexes. Submit `chooseTriggerMode` with `mode`; existing `chooseTriggerTarget`/`chooseTriggerTargets` commands follow when needed. The chosen index and readable label remain on the stack and in deterministic replays. Bots and opaque sessions use this same boundary.

Modes requiring unavailable targets cannot be chosen. Independent target groups with zero minimums remain legal with an empty plan. If no mode can be chosen, the ability is removed rather than postponed. Once announced, a mode never switches because its targets disappear. Source and target incarnation references retain existing last-known-information and zone-change behavior.

Schema and native validation reject shared effects/targets, duplicate or missing labels, unsupported fields and cross-group exclusions. Choose-many, choose-one-or-both, repeatable modes and “not previously chosen” mode memory are **not** implemented by this change. A resolution-time `conditional` effect remains distinct from choosing a mode: Sylvan Scavenging can select its Raccoon mode without a qualifying creature, then checks power during resolution.

## Complete cards in this source batch

Oracle identities, full text, types, costs and statistics were checked against the repository's October 2026 Standard inventory. Charming Prince was also cross-checked against the [Foundations release notes](https://media.wizards.com/2024/downloads/FDN_Release_Notes_dPeeQG7XyE/EN_FDN%20Release%20Notes%2008282024.pdf).

| Card                          | Important distinction tested                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Charming Prince               | Scry 2, gain 3, or blink another creature **you own**; returns under your control even if stolen beforehand             |
| Kykar, Zephyr Awakener        | Noncreature **cast** trigger; blink another creature **you control** back to its owner, or create a white flying Spirit |
| Oltec Archaeologists          | Own artifact graveyard recursion versus private scry 3                                                                  |
| Oltec Matterweaver            | Creature-cast trigger; artifact Gnome or copy your artifact token, not a nontoken artifact                              |
| White Widow, Free Agent       | Zero, one or two creature targets on either side; separate own artifact/enchantment recursion mode                      |
| Yuriko, Hope from the Shadows | Flash; graveyard-count power reduction evaluated at resolution versus private surveil 2                                 |
| Sylvan Scavenging             | Your end step only; targeted counter versus resolution-conditional 3/3 green Raccoon                                    |

The token definitions are white 1/1 flying Spirit and green 3/3 Raccoon. The existing colorless 1/1 artifact Gnome is reused. Additional modal source-card batches can depend on this contract without per-card engine hooks.

## Verification

Focused regressions cover legal/illegal modes, required and optional targets, APNAP ordering, no priority during announcements, optional resolution, source departure, stale targets, token references, schema/native roundtrips, deterministic replay, opaque handles, hidden-library invariance and actual card outcomes.

The client presents readable mode buttons, disables modes with no legal targets, explains announcement timing, and supports dismiss/reopen. DOM lifecycle tests cover duplicated stale clicks and the transition into target selection, including Read/Back and dismissed target stages. Physical-browser and iOS visual layout remain unverified in this environment; DOM checks are not a screenshot substitute.
