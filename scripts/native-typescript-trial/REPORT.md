# Native TypeScript trial — 2026-09-16

Adopt `@typescript/native-preview@7.0.0-dev.20260707.2` **only for `packages/types` Rslib declaration generation**. Its full build median improves by **30.2% (0.891 seconds)** with all 60 emitted artifacts byte-identical, strict TypeScript 4.7.4 compatibility, and preserved semantic failure detection. Keep core and plugin-utils on their existing backend: the newer preview rejects their module resolution, while the older one has unresolved declaration/map differences. Keep Next's February compiler pin unchanged.

Trial base: `916e16394de38e01789309ea314f23e6ad436c46`. No sibling branch changes were included. See [reproduction commands and methodology](README.md), [compatibility evidence](results/verification.json), and [benchmark samples](results/benchmark.json).

## Compatibility

| Package        | February preview                                                                                                                   | July preview                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `types`        | Semantic checks pass; direct CLI outputs identical; Rslib's 45 JS/declaration artifacts identical, 2 of 15 declaration maps differ | Semantic checks pass; all 60 Rslib artifacts including maps identical |
| `core`         | Semantic checks pass; 8 Rslib declarations and 44 maps differ                                                                      | CLI and Rslib fail with TS5108: Node10 resolution removed             |
| `plugin-utils` | Semantic checks pass; all 18 Rslib JS/declaration artifacts identical, 1 of 6 maps differs                                         | CLI and Rslib fail with TS5108: Node10 resolution removed             |

The seven supported package/compiler combinations pass clean CLI checks. All seven also reject a deliberate semantic TS2322 error, both directly and through the real Rslib build backend. The July failures occur before semantic checking; their quick failure is never counted as a performance improvement. No compiler flags were weakened to make candidates pass.

TypeScript 4.7.4 strictly checks the complete emitted `types` declaration entrypoint graph from each of the three compilers, with `skipLibCheck: false`. The July Rslib output matches the baseline byte for byte. This does not establish older-consumer compatibility for the changed core declarations or validate every SDK's installed tarball.

The February core differences include expanding the `KnownUnsafeEditableEvent` alias into a literal union, changing union ordering, and removing private-member JSDoc. A difference is not automatically a semantic regression, but byte parity is not established. Source maps were compared separately and were not silently discarded from the compatibility decision.

## Versions and scope

Direct CLI baseline: TypeScript **5.8.2**. Native candidates: **7.0.0-dev.20260216.1** (the existing Next pin) and **7.0.0-dev.20260707.2** (the observed registry preview `latest`, isolated during the trial and now explicitly adopted only by `types`). Rslib is **0.23.2**; its existing TypeScript peer is **5.8.2** for `types` and **5.9.3** for core/plugin-utils. The distinction is recorded rather than describing every production baseline as 5.8.2.

The new preview is older than the repository's seven-day dependency cooldown. Next's compiler version, the root TypeScript catalog, compiler-API tools, and Vitest versions remain unchanged. The trial does not consume sibling semantic-check scripts.

## Measurement

Measured on Apple M4 Pro (14 logical CPUs, 48 GiB RAM), macOS/Darwin 25.6.0 arm64, Node 24.21.0, pnpm 11.7.0. Values below are medians of five warm samples in milliseconds; all individual samples and the separate first timed invocation are in the JSON.

| Package      | Operation               | Baseline | February preview | July preview |
| ------------ | ----------------------- | -------: | ---------------: | -----------: |
| types        | Semantic CLI check      |    902.1 |            201.0 |        205.7 |
| types        | CLI JS/declaration emit |    928.0 |            207.2 |        210.0 |
| types        | Full Rslib build        |   2949.6 |           2061.9 |       2058.7 |
| core         | Semantic CLI check      |    619.5 |             83.3 | incompatible |
| core         | CLI JS/declaration emit |    768.8 |             97.2 | incompatible |
| core         | Full Rslib build        |   2665.0 |           1973.2 | incompatible |
| plugin-utils | Semantic CLI check      |    457.7 |             72.8 | incompatible |
| plugin-utils | CLI JS/declaration emit |    474.2 |             73.8 | incompatible |
| plugin-utils | Full Rslib build        |   2404.6 |           1941.6 | incompatible |

The selected types compiler makes its semantic CLI check about 4.4× faster, but the full Rslib build only about 1.43× faster. That measured local build benefit supports the narrow adoption; it does not establish an equivalent CI/monorepo speedup. The larger compiler-only gains elsewhere do not outweigh unresolved compatibility.

At **09:40:14 UTC**, all five sibling threads were independently confirmed idle and the process scan found no relevant build/test/install processes. The parent explicitly paused heavy validation. The full benchmark ran from approximately **09:40:22 to 09:43 UTC**. After a manual interruption of the agent conversation, inspection found the job had already completed normally, no surviving trial jobs, and all 27 result rows: 21 successful rows with five samples each and six unsupported rows. Every median was recomputed and validated; no partial runs were combined. See [quiet-window evidence](results/quiet-window.json).

Timings were collected before the production config change, against the stated base. Final compatibility verification was repeated after adoption; its root lockfile hash therefore differs from the benchmark's. The harness explicitly selects the old Rslib backend for baseline cases even after adoption. The lockfile adds a native-peer snapshot selected only by the types importer; other package importers and existing snapshots are preserved. No other package's compiler selection or TypeScript API version changes.

## Boundaries

These are fresh-process, clean-output, warm-filesystem measurements. They include startup overhead, exclude dependency installation, and disable incremental compilation. The first timed sample follows an eligibility run; it is **not a cold-cache result**. Five subsequent samples follow one extra priming run. CLI order rotates; Rslib runs are grouped by compiler. Raw samples, exact argument lists, exit codes, host information, and lockfile hashes are retained in JSON.

The Rslib measurements retain both production module formats and semantic declaration checking. Direct `tsgo` CLI speedups must not be projected onto the full build: bundling, process startup, declaration postprocessing, Turbo scheduling/cache hits, and unrelated packages contribute different costs. No whole-monorepo, watch/incremental, cold-OS-cache, Linux CI, or installed-tarball performance claim is made.

The JavaScript `typescript` dependency remains necessary for the documentation type resolver, API Extractor, ts-node, and Rollup tooling. The native preview's APIs are not a drop-in substitute. Oxc does not replace semantic checking.

## Validation

- Root and isolated trial dependency installs; final isolated install with `--frozen-lockfile`.
- Representative prerequisite builds through Turbo.
- Positive CLI and Rslib builds, byte/hash parity checks, and failing semantic canaries.
- Native types watch check: initial emit, declaration update, semantic failure, and recovery.
- Strict TypeScript 4.7.4 declaration checks for all three `types` outputs.
- Dependency cooldown policy suite: 7 tests passed.
- Benchmark refuses to run without an explicit quiet-window note.
- Focused Oxfmt, Oxlint, Node syntax checks, and `git diff --check`.
