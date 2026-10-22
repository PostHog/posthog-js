- check replay incident risk: A change to session replay, the lazy-loaded bundles or the rrweb fork is checked against past replay incidents before it merges.
  when: edit packages/browser/src/extensions/replay/** | edit packages/browser/src/entrypoints/** | edit packages/rrweb/** | explicit
  step: run the replay-incident-risk skill (.agents/skills/replay-incident-risk/SKILL.md) against the diff
  step: read only the INCIDENTS.md classes the diff matches, and answer each of their questions
  step: say in the PR description which classes matched and how the change avoids repeating them
  leaves: the PR description's incident-risk note
  pitfall: flipping the unknown idle state to not idle made every idle background tab ship a billed recording on each rotation (ba7042bd3)
  learned: bfd878576, ba7042bd3
  because: replay changes have caused fleet-wide recording loss, over-recording that inflated bills, and a stored XSS, mostly by repeating a few known patterns
