# Released policy reference

These seven modules freeze the v0.22.0 policy at commit
`dae135954740ff4d8e50fa6094c31e64e539c275`. Only relative imports and formatting
were adapted. Rules modules remain shared so both competitors use the same engine.
Do not update this policy when improving the default bot. The older
`../pre-tactical-policy.js` continues to own the historic replay contract.

The evaluation CLI hashes the transitive policy source graph as well as recording
the ruleset/configuration fingerprints returned by `runEpisode`. This reference is
intended for comparisons on the v0.22 card/rules surface; later mechanics can need
a separately named opponent rather than retroactively changing this reference.
