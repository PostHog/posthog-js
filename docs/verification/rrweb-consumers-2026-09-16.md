# rrweb installed-consumer verification — 2026-09-16

Baseline: `916e16394de38e01789309ea314f23e6ad436c46`.
Branch: `chore/tooling-rrweb-consumer-validation`.
Worktree: `/Users/marandaneto/Github/.worktrees/tooling-modernization-20260916/rrweb-consumer-validation`.
Environment: macOS arm64, Node `24.21.0`, pnpm `11.7.0`.

Dependencies were installed in this worktree using the frozen lockfile; no other worktree's `node_modules` was linked.
The commands below ran against the baseline with no source, manifest, lockfile, compiler, or test changes.

| Command                           | Result                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`  | Exit 0                                                                                 |
| `pnpm test:rrweb-package-exports` | Exit 0; 17 tests passed, none failed or skipped                                        |
| `pnpm test:rrweb-consumers`       | Exit 0; 14 matrix cases passed (15 tests including the parent), none failed or skipped |

## Previously reported blockers

- **rrweb-all missing runtime exports:** installed ESM and CommonJS entrypoints expose `record`, `Replayer`, `pack`, and `unpack`. Legacy manifest targets and physical bundle paths exist.
- **rrweb missing rrweb.css:** both `@posthog/rrweb/dist/rrweb.css` and `@posthog/rrweb/dist/style.css` resolve to the existing stylesheet in ESM and CommonJS.
- **rrdom-nodejs native ESM require(nwsapi):** installed native import and require fixtures pass selectors, styles, and polyfill assertions, with and without an existing `performance` global.
- **Strict declaration failures:** all 14 matrix cases below pass against installed tarballs, including the SimplePeer shim and coexistence with consumer Node typings.

## Scope and evidence

Both suites install actual packed artifacts. The export suite also checks static tarball targets, relative imports,
identical dual declarations, and installed `.mts`/`.cts` consumers with `skipLibCheck: false`.
The strict consumer suite checks rrdom-nodejs, the canvas WebRTC recording plugin, and core with `strict: true`,
`skipLibCheck: false`, and NodeNext resolution. Its matrix is:

| Consumer typings      | TypeScript versions | Formats        |
| --------------------- | ------------------- | -------------- |
| Browser               | 4.7.4, 5.8.2, 6.0.3 | `.mts`, `.cts` |
| `@types/node` 22.19.1 | 5.8.2, 6.0.3        | `.mts`, `.cts` |
| `@types/node` 24.13.3 | 5.8.2, 6.0.3        | `.mts`, `.cts` |

Node 22/24 refers to consumer **typings**, not a runtime matrix. TypeScript 4.7 is tested only in the browser row.
The Node rows verify that the consumer's Node declarations are loaded and legacy Node 16 declarations are not.
This is focused package compatibility validation, not a browser recording, delivery, watch-mode, or full SDK test run.
Turbo may reuse build cache entries (the export run reported 8 of 10 tasks cached); packing and consumer checks run afresh.

Logs are retained locally under `target/rrweb-consumer-validation/` (ignored build artifacts).
The export suite removes its temporary installation on completion. The strict suite retains its installation,
tarballs, lockfiles, build/pack logs, and all compiler `--listFiles` output; its exact directory is recorded below.

Artifact directory: `/var/folders/wd/xy_50dtj5m3_zj_l5qm_n9800000gn/T/rrweb-consumer-types-jqou1Y`.
Top-level fixture logs are also copied to `target/rrweb-consumer-validation/compiler-logs/`.

A search of tracked filenames and Markdown content found no modernization backlog recording these deferred checks.
[CONTRIBUTING.md](../../CONTRIBUTING.md#rrweb-declaration-builds) already documents both suites, and
[the unit CI job](../../.github/workflows/library-ci.yml) already runs them in its installed rrweb consumer step.
This report records independent verification; no external backlog was updated.

All four previously reported blockers are resolved at this baseline within the tested scope. No product or environment failure occurred.
No runtime fix or changeset was needed; this commit only adds verification documentation.
