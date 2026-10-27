# Role Aura tokens

The six Roles used by Standard cards are real colorless enchantment tokens named
**Cursed**, **Monster**, **Royal**, **Sorcerer**, **Wicked**, and **Young Hero**.
Their subtypes are **Aura Role**; “Monster” and the other token names are not
additional subtypes. All have enchant creature. The non-Standard Virtuous Role
is not added by this bounded change.

## Authoring and exact attachment

`createAttachedToken` creates one token and puts it onto the battlefield already
attached. Source examples:

```json
{ "op": "createAttachedToken", "token": "leyline:token/royal-role", "target": "target" }
{ "op": "createAttachedToken", "token": "leyline:token/cursed-role", "target": "source" }
```

The six token IDs end in `cursed-role`, `monster-role`, `royal-role`,
`sorcerer-role`, `wicked-role`, and `young-hero-role`. The instruction lowers to
`attachedToken`, a definition name, and an optional `subject`. A `targetGroup`
is supported for the explicit target binding. `eventSource` is a nontargeting
binding to the recorded event object's exact incarnation. `source` likewise
uses the exact source incarnation; neither follows the object through a blink.

Attachment must be legal before a token object is created. An absent, stale,
noncreature, or otherwise illegal enchant recipient produces no token and no
entry/departure event. Nontargeted attachment does not check shroud/hexproof;
targeted spell and trigger recipients pass through normal target validation.

There is no `amount` or arbitrary remembered-object binding. Generic `createToken` /
`token` instructions reject Aura-token references; the explicit attachment contract
is required, so unsupported entry choices cannot be silently overwritten. This also
rejects previously accepted custom generic Aura-token definitions whose single-token
entry ran later instructions before attachment and whose multi-token entry lost
continuations. Ordinary tokens, Aura copies, and non-token Aura entry batches are
unaffected. **Return Triumphant**
uses the bounded compound `moveTarget` instruction with
`attachedToken: "leyline:token/young-hero-role"` (a token definition name natively).
It accepts one targeted graveyard creature returned to the battlefield, not
self/grouped/hand/battlefield-target approximations. The entry continuation
captures the actual new incarnation after entry, then creates and attaches the
Role. Creature-type entry choices persist that continuation; no Role exists
before entry, no priority window intervenes, and a resumed instruction cannot
create a second Role. A stale or illegal graveyard target returns nothing and
creates no Role. This is not a general remembered-object binding.

**Not Dead After All** uses the separate bounded `grantDeathReturn` instruction:
`target: "target"`, `until: "endOfTurn"`, `tapped: true`, and
`attachedToken: "leyline:token/wicked-role"`. It adds a timestamped ability to the
creature, not a spell-owned delayed watcher. At its own battlefield-to-graveyard
move, the controller at that moment controls the trigger. “This creature” is
source identity, not a creature-type condition, so a later type-only change does
not erase the own-departure event. Removal of abilities does erase older grants;
newer grants survive, and cleanup removes grants not yet triggered.

The trigger retains the exact new graveyard incarnation. It returns that card
tapped under its owner's control and creates the Wicked Role under the trigger
controller's control, including after an entry-choice pause. A noncreature card
can return, but receives no illegally attached Role. Tokens, exile replacements,
intervening graveyard moves, and later copies of the creature cannot manufacture
extra returns. Multiple grants trigger independently, but only the first
resolution can find the original graveyard incarnation. The grant is not a copy
value and does not survive the creature's return.

## Continuous effects and grants

`attachmentBonus.baseStats` applies in the base-stat layer with timestamps,
before counters and additive bonuses. `attachmentBonus.ward` grants an
additional ward ability; it does not overwrite printed ward. Each ward instance
produces its own trigger controlled by the enchanted creature's controller.

`attachmentTriggered` is a bounded authoring ability for grants of a creature's
own attack trigger. It lowers to `attachmentTriggers`, not an Aura-owned event
watcher. The creature is the trigger's source and controller; removing the Aura
after the attack does not erase the trigger. Grants respect ability-removal
timestamps and are not copy values. This does not change Equipment observer
semantics. Once-per-turn grants, targeted grants and arbitrary event families
are not admitted by this bounded contract.

Young Hero uses the intervening-if `sourceToughnessAtMost` predicate at both
trigger occurrence and resolution. Wicked's battlefield-to-graveyard trigger
belongs to the Aura itself, not the enchanted creature.

## State-based actions

The newest Role survives among Roles attached to one incarnation and controlled
by one player. The other player may independently control another Role on that
same creature. Old Roles go to their owners' graveyards, not by sacrifice.
Their movement shares the same pre-departure snapshot as simultaneous lethal
creatures, illegal Auras, legend-rule departures, and completed Saga sacrifices.

Simultaneous attached-Role entry retains a shared entry-batch timestamp and asks
the controller which Role to retain. This uses the existing mandatory
state-based-choice transport (`legendRule` / `chooseLegend`) with `rule: "role"`
and explicit Role UI wording. All choices precede the shared departure batch;
selecting an otherwise illegal permanent does not rescue it from another SBA.
The bounded token instruction creates only one token at a time; general
simultaneous timestamp ordering and token-doubling replacements are not added.

## Verification and references

Focused tests: `packages/engine/test/role-tokens.test.js` and
`tests/role-token-schema.test.js`, `tests/return-attached-token.test.js`,
`tests/not-dead-after-all.test.js`, together with the existing Aura, Equipment,
legend-rule, and ward suites. These cover actual attachments, illegal creation,
incarnation changes, controller separation, simultaneous departures and choices,
base-stat ordering, additive ward, granted trigger ownership, ability loss,
copy values, schema rejection, and source round trips. The Role choice lifecycle additionally covers readable fallback faces, selection,
Read/Back, dismissal/reopening, stale clicks and unchanged catalog-cache writes.
Client checks are DOM only; no browser/layout verification is claimed.

Rules baseline: [Comprehensive Rules effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt),
111.10j–r, 201.5, 303.4g/i, 303.7a, 400.7, 603.4, 613.1f/g, 613.4b/c, 613.7 and 704.5z;
[official Wilds of Eldraine release notes](https://magic.wizards.com/en/news/feature/wilds-of-eldraine-release-notes)
confirm the six Standard Role definitions, per-controller uniqueness,
simultaneous choice, and illegal-attachment prevention.

## Complete cards in v0.56

The 22 admitted cards are Become Brutes; Besotted Knight // Betroth the Beast;
Charmed Clothier; Charming Scoundrel; Conceited Witch // Price of Beauty;
Cursed Courtier; Cut In; Diminisher Witch; Embereth Veteran;
Ferocious Werefox // Guard Change; Hunter's Axe; Living Lectern;
Not Dead After All; Protective Parents; Redtooth Genealogist; Return Triumphant;
Royal Treatment; Shatter the Oath; Spiteful Hexmage; Splashy Spellcaster;
The Witch's Vanity; and Witch's Mark. Full main and Adventure faces are retained.
Hunter's Axe shares creature-owned attachment grants without creating a Role.

Each admitted non-token card and its Adventure aliases has verified display metadata.
The six Role tokens retain readable name/rules fallback faces rather than an ambiguous
printed image containing a second Role. This does not change token identities or rules.
