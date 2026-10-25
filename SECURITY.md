# Security boundaries

Leyline is currently a local game and developer tool. It is not a trusted multiplayer server or a sandbox for untrusted JavaScript.

- No authentication, payment system, telemetry or account storage is implemented.
- Imported deck text is parsed as data and rendered with escaping; it is never evaluated.
- Imported replays are version-checked and re-run through command validation. The browser limits file size to 5 MB and command count to 5,000; the engine limits command count to 10,000. Those limits are not a proof against denial of service.
- Replays and developer views reveal both decks, hands and libraries. Do not share a live competitive game's replay.
- Card images are requested from Scryfall's image service, which receives ordinary browser request metadata. Engine execution works without those images.
- The local preview server serves only web assets and engine modules. Do not expose it to the public internet.

For security-sensitive reports, avoid posting credentials or personal match data. Use a private reporting route offered by GitHub if one is enabled by the repository owner; this project does not claim that such a route has been configured.
