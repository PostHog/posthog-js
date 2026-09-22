# Agent Instructions

- Read and follow [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing to the SDKs. It contains repository structure, environment setup, development commands, testing, linting, dependency policies, and PR requirements.
- Read and follow [RELEASING.md](./RELEASING.md) when adding changesets or working on publishing or release recovery.
- Public API changes: reviews, investigations, and explicitly requested changes do not require a separate GitHub issue; do not stop those tasks because an issue is missing. A human's request authorizes the requested API change, not unrelated API additions.
- If implementation would require a new or changed public API outside the requested scope, propose its shape and rationale in the PR description, or in your response if no PR exists, before implementing that additional API. Let the human decide whether an issue is needed. Never open an issue automatically.
- Follow [Public API changes](./CONTRIBUTING.md#public-api-changes) for design guidance. Treat changed signatures, types, or members in `*-references-latest.json`, and new or changed exports, as signals to inspect, not automatic workflow gates. For SDK design guidance, read https://posthog.com/handbook/engineering/sdks/guidelines.md.
- Check for package-level `AGENTS.md` files and contributor guides before working in a package.
- Keep shared development guidance in `CONTRIBUTING.md` and release guidance in `RELEASING.md` rather than duplicating it here.

## Task routing

Load the guides and skills relevant to the task; do not load every skill by default. These supplement the contributor guidance above.

| Task                                                                                                                                                         | Guide or skill                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Work in a package                                                                                                                                            | Its applicable `AGENTS.md` and [package-specific contributor guide](./CONTRIBUTING.md#package-specific-guides)                          |
| Fix a bug                                                                                                                                                    | [Contract-based regression tests](./CONTRIBUTING.md#contract-based-regression-tests)                                                    |
| Select checks or report validation                                                                                                                           | [Verification by change type](./CONTRIBUTING.md#verification-by-change-type)                                                            |
| Change generated output                                                                                                                                      | [Generated outputs and their owners](./CONTRIBUTING.md#generated-outputs-and-their-owners)                                              |
| Change recording, rrweb, lazy-loaded entrypoints, session rotation/idle handling, fetch/XHR wrappers, recording triggers/remote config, or release workflows | [Replay incident risk](./.agents/skills/replay-incident-risk/SKILL.md)                                                                  |
| Compare `array.js` size quickly                                                                                                                              | [Compare array bundle size](./.agents/skills/compare-array-bundle-size/SKILL.md) (an esbuild proxy, not production bundle measurements) |
| Review changeset coverage or release notes                                                                                                                   | [Review changesets](./.agents/skills/review-changesets/SKILL.md)                                                                        |
| Publish or recover a release                                                                                                                                 | [RELEASING.md](./RELEASING.md)                                                                                                          |
