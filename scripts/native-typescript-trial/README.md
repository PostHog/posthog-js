# Native TypeScript trial

This opt-in trial compares the repository compiler with two exact native preview versions. The measured decision adopts the July preview only for `packages/types` Rslib declarations; other package backends and Next’s existing pin remain unchanged. Semantic checking and the JavaScript TypeScript compiler API are retained.

## Reproduce

Use Node 24 and the repository's pnpm 11.7.0. Install in this checkout; do not borrow another checkout's `node_modules`.

```sh
pnpm install --frozen-lockfile
pnpm --dir scripts/native-typescript-trial install --frozen-lockfile
pnpm turbo run build --filter=@posthog/types --filter=@posthog/core --filter=@posthog/plugin-utils
node scripts/native-typescript-trial/trial.mjs verify /tmp/native-typescript-verify.json
```

The independent trial workspace has its own lockfile and seven-day dependency cooldown. Trial-only installation does not affect production peer resolution. The adopted compiler is separately pinned in `packages/types`; `packages/next` keeps its existing pin. All representative packages use the root contributor instructions; none has an additional package-level guide.

Wait until other builds, tests, dependency installs, and benchmarks on the host have stopped. Record how this was established:

```sh
TRIAL_QUIET_WINDOW='Describe the idle-thread and process checks here' \
  TRIAL_RUNS=5 node scripts/native-typescript-trial/trial.mjs benchmark /tmp/native-typescript-benchmark.json
```

`verify` never times work. `benchmark` requires the explicit quiet-window note, records all successful samples and their median, and records incompatible configurations without timing them. A failed baseline or successful checker that misses the injected semantic error aborts verification. Compiler incompatibilities and output differences are evidence to review, not automatic acceptance.

## What is measured

- `types`: shared public declarations, bundler resolution, TypeScript 5.8.2 production peer.
- `core`: larger shared runtime, CommonJS/Node10 resolution, TypeScript 5.9.3 production peer resolved by the existing Rslib lockfile.
- `plugin-utils`: small Node utility package, CommonJS/Node10 resolution, TypeScript 5.9.3 production peer.
- Direct CLI checks and JS/declaration emission always compare against root TypeScript 5.8.2. CLI maps are disabled for byte comparisons; all other project settings stay intact.
- Rslib 0.23.2 builds use the real package configuration, both ESM and CommonJS, with only temporary output directories and the `dts.tsgo` switch overridden. Rslib's baseline retains its actual installed TypeScript peer. A temporary link resolves the chosen native compiler from **this checkout's installed dependencies** and is removed afterward. A pre-existing pnpm compiler symlink is saved and restored in `finally`; real directories are never replaced. Do not run the trial concurrently with another task in this checkout.
- Each supported CLI and Rslib path must reject a deliberate `string = 123` error with TS2322. Clean diagnostic output and exit codes are recorded. This is a focused regression probe, not proof of complete checker equivalence.
- Generated file hashes are compared by relative path; Rslib maps are reported separately. A direct compiler emit is not a replacement for Rslib's module formatting, export rewriting, or packaging.
- TypeScript 4.7.4 checks the emitted `types` entrypoint strictly, with `skipLibCheck: false` and no ambient dependency types. This is a declaration graph check, not an installed-tarball consumer matrix for every SDK.

Every timed invocation starts a new process with incremental compilation disabled. Compiler startup and process overhead are included. Eligibility runs precede timing, followed by a first timed sample, one extra unmeasured priming run, and five measured samples. CLI compiler order rotates between rounds; Rslib samples are grouped by compiler, so order bias remains possible. Dependencies stay built. Emit/build output directories are removed before each run; Turbo is bypassed. This measures clean-output builds with warm filesystem caches, **not** cold disk caches, dependency installation, watch/incremental rebuilds, remote Turbo cache hits, or the monorepo critical path. No OS cache flushing is attempted.

After adoption, check native watch-mode behavior on POSIX systems with:

```sh
node scripts/native-typescript-trial/watch-check.mjs
```

It checks initial declarations, a declaration-changing edit, TS2322 reporting, and recovery after fixing the error, then stops the whole watcher process group.

The harness uses temporary package configs and, during negative build checks, a temporary source file. Run it without concurrent work in the same checkout. Normal completion and ordinary failures clean these up; after a forced process kill inspect `.native-trial-*`, `__native_trial_canary_*`, and the trial compiler links before resuming development.

## Upstream and adoption constraints

Sources inspected on 2026-09-16:

- [Microsoft native compiler README](https://github.com/microsoft/typescript-go): the staging repository is archived and points ongoing development to TypeScript. Its capability table and migration notes are not a promise that older preview binaries have every current feature.
- [Native compiler intentional changes](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md): checking and emitted declarations have documented differences; JavaScript inference in particular is not guaranteed to match the old compiler.
- [Rslib declaration configuration](https://rslib.rs/config/lib/dts): native declaration generation is a distinct backend. This trial also inspected the installed 0.23.2 implementation instead of assuming current website options exist in the installed version.

The existing Next native pin is `7.0.0-dev.20260216.1` (upstream git `4b301b2d3a6c626d0c932b6db182c63d9a98505e`). The registry `latest` preview observed for this trial is `7.0.0-dev.20260707.2` (git `9977d6d38fcc78de8ae71770f3aa08256e6cc861`); it is pinned here and in the adopted types package, not resolved from a moving tag. This is a preview comparison, not an evaluation of every subsequent TypeScript 7 release.

Keep `typescript` available for `scripts/docs/type-resolver.js`, API Extractor, ts-node, and Rollup's TypeScript plugin. Native CLI adoption does not replace those JavaScript APIs. Do not change consumer TypeScript minimums or ambient dependencies to make this benchmark pass. Oxc declaration generation does not perform semantic checking.

See [the recorded trial report](REPORT.md) for the measured decision and limitations.
