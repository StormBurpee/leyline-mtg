# Resolution-time alternatives

`chooseEffect` represents inline, nonmodal choices made while an instruction resolves
(CR 608.2c–d and 117.2e, Comprehensive Rules effective September 25, 2026,
[official rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)).
It is not a replacement for spell modes or triggered `choose one —` modes, which
must be announced before targets and before players receive priority.

```json
{
  "op": "chooseEffect",
  "options": [
    {
      "label": "Create a Food token",
      "effects": [{ "op": "createToken", "token": "leyline:token/food-token", "amount": 1 }]
    },
    {
      "label": "Create a Treasure token",
      "effects": [{ "op": "createToken", "token": "leyline:token/treasure-token", "amount": 1 }]
    }
  ]
}
```

## Contract

- Two to eight labeled alternatives, sharing the ordinary effect-depth and
  instruction budgets. An empty branch is an explicit decline/no-action outcome.
- Optional `player: "controller" | "opponent"` chooses the decision maker only.
  It never changes the entry controller, source incarnation, or announced targets.
- Optional branch `condition` uses `EffectCondition`, checked at this instruction
  after prior effects. Authors must encode restrictions that make a choice illegal
  or impossible (for example tap only an untapped announced target). This is not a
  general solver for whether arbitrary effect graphs can be performed.
- Ineligible alternatives are not offered. If none are eligible, that instruction
  is skipped. With one eligible alternative the player still receives an explicit
  choice; there is no priority window.
- Branches cannot declare new targets, payment costs, or modal choices. They may
  reuse existing primary/group targets. Reflexive triggers continue to require
  their explicit trigger opcodes; inline choices do not simulate them.
- `chooseEffect { option: number }` accepts only an offered integer index. The
  chosen instructions are inserted before the remaining instructions, so nested
  decisions, library ordering and permanent entry choices resume the exact cursor.
- Token references are validated throughout all branches, including unselected
  alternatives, conditional branches, and explicit reflexive trigger bodies.

The client shows readable branch labels with source/target card reading, Back,
View battlefield and reopening. Closing the dialog does not choose a branch or
pass priority. Hidden-zone source cards are not exposed by this gallery. Duplicate
stale clicks are rejected by the usual decision lease/revision boundary.

The opaque simulation API offers the same commands. The deterministic bot chooses
an offered branch and, for its own effects, avoids branches with immediate known
life/deck-out risk when an alternative exists. It does not claim sophisticated
comparative evaluation of every alternative or of an opponent-controlled effect.

## Complete cards in v0.55

- **Ant-Man's Army:** chooses Food or Treasure during its ETB's resolution, not
  while that trigger is put onto the stack.
- **Ezrim, Agency Chief:** flying, two Clues, artifact sacrifice cost, then one of
  vigilance/lifelink/hexproof until end of turn.
- **Hungering Puppetbeast:** Heartwood ETB, sacrifice another artifact, counter
  before the choice, then one of trample/hexproof/haste until end of turn.
- **Sanctuary Wall:** defender; tap the announced target first, then optionally put
  stun counters on that target and the original Wall incarnation.

- **Granite Witness:** flying, vigilance and Disguise; turning it face up announces
  a creature target before the optional tap-or-untap resolution choice.
- **Manifold Mouse:** paid offspring creates the exact 1/1 copy; its own-combat
  trigger targets a controlled Mouse before choosing double strike or trample.
- **Sewer-veillance Cam:** flash, independent entry/departure tap-or-untap choices,
  and a source-sacrifice draw ability whose departure trigger remains separate.
- **Wingnut, Bat on the Belfry:** Alliance chooses flying, menace or haste during
  resolution; its attack trigger pumps only the other attacking creatures.

Oracle clauses and identities were checked against the local dated Standard
inventory. The first four cards preserve their review in
`tests/fixtures/effect-choices-oracle-reviewed.json`; the additional complete
sources are covered by `tests/standard-m-z-resolving-choice.test.js` and
`packages/engine/test/standard-a-l-granite.test.js`.

## Deliberately not unlocked

**Back for Seconds** still requires a mixed-destination batch: reanimating one
eligible announced card while returning the other to hand must preserve the
single instruction's simultaneous movement and entry/replacement observations.
Sequential `moveTarget` branches would approximate this, so no source is added.

**Transmutation Font** still needs a cost that sacrifices exactly three artifact
tokens with distinct names. This opcode alone does not provide that cost.

Reflexive sacrifice/discard choices, new resolution targets, arbitrary
replacement effects, and simultaneous multi-player alternative choices are not
claimed by this implementation.
