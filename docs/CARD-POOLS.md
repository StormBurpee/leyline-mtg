# Card-pool acceptance targets

1. Every Standard-legal card.
2. Every non-Alchemy card available on Arena, using original tabletop characteristics rather than rebalanced variants.

These are implementation targets, not completed features. Format legality, Arena availability, executable rules and tested interactions are different properties.

## Snapshot: 26 October 2026

The maintenance queries use Scryfall Oracle identities, exclude future printings and retain per-page retrieval timestamps and hashes. The live service is not queried during games or CI.

| Inventory         | In scope | Curated definitions | Compiler candidates | Unsupported scripts | No exact Forge match |
| ----------------- | -------: | ------------------: | ------------------: | ------------------: | -------------------: |
| Standard          |    5,164 |                 730 |                   0 |               4,173 |                  261 |
| Non-Alchemy Arena |   15,332 |                 936 |                 597 |              13,114 |                  685 |

- **Curated:** a definition in the executable registry, subject to the kernel's documented interaction limits. Not a certification of all Magic rules.
- **Compiler candidate:** the adapter recognizes its syntax. Not installed or counted as playable.
- **Unsupported:** a matching script requires rules or grammar the adapter does not implement.
- **No exact match:** no unique exact-name script match. Split faces, naming conventions and newer cards can require separate reconciliation.

The Arena response also contained 38 auxiliary token/emblem records and three Alchemy-tagged reprints. Those are counted separately and excluded from the main-deck denominator. Arena starter cards are not discarded simply because a printing is digital. The broad `is:digital` filter would also remove ordinary cards in digital remastered sets.

These are Scryfall inventories, not a verified export of an installed Arena client. Special events, cards unavailable for deck construction and source metadata differences still need reconciliation. Standard legality reflects the provider at retrieval time, not historical legality calculated from a date; Arena best-of-one exceptions need their own format layer.

## Inspect the evidence

- [Standard summary](card-pools/standard-2026-10-26/summary.json)
- [Arena summary](card-pools/arena-2026-10-26/summary.json)
- Alphabetic JSON shards beside each summary contain every Oracle ID, card name and implementation status.
- `keywordsOnUnimplementedCards` counts keywords appearing on incomplete cards. It does not mean the keyword itself is missing: a flying creature can still need an unsupported triggered ability.

## Rebuild

```sh
node scripts/snapshot-card-pool.mjs standard research/standard-pool.json
node scripts/snapshot-card-pool.mjs arena research/arena-pool.json
node scripts/import-forge.mjs path/to/forge/forge-gui/res/cardsfolder research/forge-report.json
node scripts/audit-card-pool.mjs research/standard-pool.json research/forge-report.json new-standard-audit
node scripts/audit-card-pool.mjs research/arena-pool.json research/forge-report.json new-arena-audit
```

Use new output paths. Snapshot pages are cached by query and date, requests are paced, pagination is checked, and errors or search warnings stop ingestion. No automatic retries are made through rate limits. A changing result count or duplicate Oracle identity invalidates the snapshot.

Source data and rules text retain their respective ownership. See [provenance](PROVENANCE.md), [Scryfall's API documentation](https://scryfall.com/docs/api), and the [official rules](https://magic.wizards.com/en/rules).
