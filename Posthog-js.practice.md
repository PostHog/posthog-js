- add a dependency cooldown exception: A package is let past the seven-day dependency cooldown only after checking who resolves it.
  when: edit pnpm-workspace.yaml adding minimumReleaseAgeExclude | explicit
  step: check whether the package stays in a published package's manifest and is resolved by consumers rather than bundled
  step: if PostHog/posthog will resolve it during its automated SDK upgrade, merge the same exact-version exception there first; otherwise wait out the cooldown
  step: pin the exception to an exact version, and record why with decide
  leaves: the decision's id
  pitfall: the cooldown held @posthog/coherence at 1.1.1, which lacked the command adoption needed, until an exact-version exception was added (d-d96167a7)
  learned: d-d96167a7, 292af505b
  because: minimumReleaseAge protects against freshly published compromised packages; an exception that reaches consumers spreads that risk to every SDK user
- add an invariant: An invariant is taken from a PostHog/sdk-specs requirement and backed by a test that already exists.
  when: edit **/*.spec.md adding via: | explicit
  step: find the requirement or scenario in PostHog/sdk-specs (openspec/specs/<capability>/spec.md) that states the rule; if none does, stop and raise it rather than invent the rule
  step: pick one existing test whose assertion checks that rule, and word the invariant to claim only what that test proves
  step: if the test's file is not yet named in its package's test command in coherence.config.json, add it there
  step: cite the sdk-specs capability and requirement or scenario in the invariant's because: line
  leaves: the citation in the because: line
  step: witness its refutation, then run spec --check and see 0 problems
  pitfall: the idle-rotation replay invariant first claimed a trigger release, a host-app release and a discard that its one test does not check, and had to be narrowed (d-5ddcdf64)
  learned: d-5ddcdf64, 187a5c5c7, 8922ab259
  because: sdk-specs is the cross-SDK source of truth for behaviour; an invariant that is not grounded in it can enforce a rule the other SDKs and the spec disagree with, and one that claims more than its test proves gives false confidence
