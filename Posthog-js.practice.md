- add a dependency cooldown exception: A package is let past the seven-day dependency cooldown only after checking who resolves it.
  when: edit pnpm-workspace.yaml adding minimumReleaseAgeExclude | explicit
  step: check whether the package stays in a published package's manifest and is resolved by consumers rather than bundled
  step: if PostHog/posthog will resolve it during its automated SDK upgrade, merge the same exact-version exception there first; otherwise wait out the cooldown
  step: pin the exception to an exact version, and record why with decide
  leaves: the decision's id
  pitfall: the cooldown held @posthog/coherence at 1.1.1, which lacked the command adoption needed, until an exact-version exception was added (d-d96167a7)
  learned: d-d96167a7, 292af505b
  because: minimumReleaseAge protects against freshly published compromised packages; an exception that reaches consumers spreads that risk to every SDK user
