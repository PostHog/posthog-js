# Contributing

## Overview

This is a pnpm monorepo containing multiple PostHog JavaScript SDKs and development tooling. The repository uses Turbo for build orchestration and supports local development through tarball-based testing.

**Key Information:**

- Development Node Version: `24.x` (see `.nvmrc` and `package.json`)
- Package Manager: `pnpm@11.7.0` (see `package.json`)
- TypeScript Catalogs: `catalog:native` pins `7.0.2`; the default `catalog:` retains `5.8.2` for legacy tooling (see `pnpm-workspace.yaml`)
- Main Branch: `main`

## Tooling

- Install [corepack](https://github.com/nodejs/corepack), if it is not already available
- Install [nvm](https://github.com/nvm-sh/nvm), if it is not already available

At the repository root, run:

```sh
nvm use
pnpm install --frozen-lockfile
```

## Folder Structure

- `./packages` - SDKs, shared libraries, build plugins, and private experimental packages
- `./playground` - Projects to test packages locally during development
- `./examples` - Simple example projects demonstrating how to install and use our SDKs
- `./target` - Generated tarballs for SDK packages (created by `pnpm package`)
- `./tooling` - Shared development packages (Oxlint plugin, Rollup utils, TSConfig base)
- `./.github` - CI/CD workflows and custom GitHub Actions

## SDK Packages

The repository contains the following top-level packages in `./packages/`:

| Package                      | Name                                 | Description                                              |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------- |
| `core/`                      | `@posthog/core`                      | Shared core functionality used by multiple SDKs          |
| `browser/`                   | `posthog-js`                         | Main browser SDK for capturing events and usage          |
| `browser-common/`            | `@posthog/browser-common`            | Internal shared browser utilities and extensions         |
| `browser-next/`              | `@posthog/browser`                   | Private experimental browser SDK                         |
| `web/`                       | `posthog-js-lite`                    | Lightweight browser SDK                                  |
| `ai/`                        | `@posthog/ai`                        | AI integrations for Node.js                              |
| `convex/`                    | `@posthog/convex`                    | Convex.dev component                                     |
| `node/`                      | `posthog-node`                       | Node.js backend SDK (see its `engines.node` requirement) |
| `mcp/`                       | `@posthog/mcp`                       | MCP server analytics                                     |
| `react/`                     | `@posthog/react`                     | React components and hooks                               |
| `react-native/`              | `posthog-react-native`               | React Native mobile SDK                                  |
| `react-native-plugin/`       | `@posthog/react-native-plugin`       | Native integration for the React Native SDK              |
| `nuxt/`                      | `@posthog/nuxt`                      | Nuxt framework module                                    |
| `next/`                      | `@posthog/next`                      | Next.js framework module                                 |
| `nextjs-config/`             | `@posthog/nextjs-config`             | Next.js configuration helper                             |
| `openfeature-node-provider/` | `@posthog/openfeature-node-provider` | OpenFeature server provider (posthog-node)               |
| `openfeature-web-provider/`  | `@posthog/openfeature-web-provider`  | OpenFeature web provider (posthog-js)                    |
| `plugin-utils/`              | `@posthog/plugin-utils`              | Shared CLI and sourcemap utilities for plugins           |
| `types/`                     | `@posthog/types`                     | TypeScript type definitions for the SDK                  |
| `rollup-plugin/`             | `@posthog/rollup-plugin`             | Rollup/Vite sourcemap upload plugin                      |
| `webpack-plugin/`            | `@posthog/webpack-plugin`            | Webpack sourcemap upload plugin                          |

Vendored recording/replay packages live under `packages/rrweb/`.

### Package-specific guides

Some packages have their own contributor guides with extra package-level checks:

- [packages/browser/CONTRIBUTING.md](packages/browser/CONTRIBUTING.md)
- [packages/react-native/CONTRIBUTING.md](packages/react-native/CONTRIBUTING.md)
- [packages/convex/CONTRIBUTING.md](packages/convex/CONTRIBUTING.md)
- [packages/nuxt/CONTRIBUTING.md](packages/nuxt/CONTRIBUTING.md)

## Workspace

- This repository is structured as a pnpm workspace and each SDK and tooling package is a member of this global workspace.
- Example and playground projects are independent pnpm workspaces. Run `pnpm install` inside the specific project folder. Projects using the shared `.pnpmfile.cjs` rewrite PostHog dependencies to local tarballs, with exclusions such as `@posthog/cli` and `posthog-react-native-session-replay`. Check the project's `pnpm-workspace.yaml` and referenced pnpmfile for its exact behavior.

## Dependency cooldown

Every pnpm workspace, including independent examples, playgrounds, and CI fixtures, sets `minimumReleaseAge: 10080` (seven days). Root workspace members inherit the root policy. Shared `.pnpmfile.cjs` hooks must not lower it. The similarly named `min-release-age` setting in `.npmrc` is not a substitute for pnpm's workspace setting.

Each independent workspace pins a pnpm version with cooldown support in `package.json`. Support starts at pnpm 10.16.0. Existing older pnpm 10 projects use 10.33.0 to avoid a major-version migration; previously unpinned workspaces use the root's 11.7.0. Both support the cooldown. A global pnpm version is not sufficient because project pins can select a different version.

Run `pnpm --version` and `pnpm config get minimumReleaseAge` inside the project to verify the selected version and effective policy, including hook overrides. Corepack and pnpm's own version manager use separate caches. With Corepack, run `corepack install` inside the project if its pinned version is not cached. Use the Node version from `.nvmrc` for repository development.

Run `pnpm test:dependency-cooldown` to check workspace settings, pnpm pins, standalone lockfiles, hook overrides, and native CI policy loading. A local mock registry also verifies that pnpm rejects a six-day-old version and resolves an eight-day-old version without downloading or executing package code. The checks run in the unit CI job.

The native plugin example has its own policy for local workspace installs. Its CI installs intentionally use `--ignore-workspace` for standalone installation, so they pass `--config.minimum-release-age=10080` explicitly alongside the hoisted linker setting. Keep that explicit cooldown whenever bypassing the workspace policy. Generated pnpm consumer fixtures also need an explicit cooldown and supported package-manager pin. The minimum-TypeScript fixture installs local tarballs for the browser SDK and its PostHog workspace dependencies, so testing the current source does not require cooldown exceptions for newly published SDK packages. These repository settings do not configure npm-based consumer tests or installations performed by SDK users.

## Dependency Release-Age Exceptions

`minimumReleaseAgeExclude` entries are repository-local and are not inherited by consumers of published packages. Before adding an exception:

1. Check whether the dependency remains in a published package's manifest and will be resolved by consumers rather than bundled into the package.
2. If `PostHog/posthog` will resolve the immature dependency during its automated SDK upgrade, ensure the same exact-version exception is merged into its `pnpm-workspace.yaml` before releasing. Otherwise, wait until the dependency satisfies the consumer's minimum release age.

## Development Commands

Turbo handles build orchestration and ensures packages are built in the correct dependency order.

### Root-Level Scripts

Run these from the repository root:

```bash
# Build all packages (respects dependency order)
pnpm build

# Check source types across all SDKs and rrweb (builds dependencies first)
pnpm check-types

# Watch mode for development
pnpm dev

# Run all tests across packages
pnpm test

# Run unit tests and their dedicated built-output checks (no rrweb browser tests)
pnpm test:unit

# Run dedicated built-output checks only
pnpm test:built

# Run rrweb tests (requires Puppeteer's Chrome; Linux CI also uses Xvfb)
pnpm test:rrweb

# Validate task ordering without compiling packages
pnpm test:build-graph

# Lint all packages
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Create tarballs for all packages
pnpm package

# Watch mode - auto-regenerate tarballs on changes
pnpm package:watch

# Generate API reference documentation
pnpm generate-references

# Clean all build artifacts
pnpm clean

# Clean all node_modules (workspace-wide)
pnpm clean:dep
```

### Semantic type checks

Every workspace package under `packages/` exposes `check-types`. Run `pnpm check-types` for all SDKs and rrweb, or `pnpm turbo run check-types --filter=posthog-node` for one SDK. Turbo builds workspace dependencies first, using the existing build graph once. Browser-next additionally builds itself because its check includes consumer fixtures. Direct package commands assume dependency outputs already exist.

The contract checks production TypeScript using the existing compiler and compiler options. Rslib packages use their build TSConfig; browser, Convex and the native plugin reuse their existing `typecheck` command. Next retains its existing `tsgo` compiler. React, React Native and the lightweight web SDK use their package TSConfig. AI uses a source-only check config. Existing broader test/fixture coverage remains in the packages that already checked it. Version-generating packages run their existing `prebuild` preparation before checking. Nuxt runs `nuxt prepare` and checks module source against the generated framework configuration.

Builds already perform different kinds of checking: browser, React Native and Convex compile with TypeScript, Next compiles with tsgo, the native plugin uses Bob's TypeScript target, Rslib generates declarations, and AI/React/web use tsdown declaration generation. These build paths remain unchanged. The explicit command provides consistent whole-source coverage independent of which bundler emits declarations; do not add a second Turbo invocation inside package scripts or prepend redundant checks to SDK builds. rrweb retains its mandatory pre-build semantic gate described below.

The Library checks unit job runs `pnpm check-types` for every package. `pnpm test:build-graph` discovers SDK and rrweb manifests to enforce coverage and dependency ordering, and injects a semantic error into a temporary workspace to verify that the root command fails even when builds succeed. New SDK packages must provide a semantic `check-types` leaf task. Do not weaken compiler options or replace semantic checking with transpilation/declaration-only validation.

### rrweb declaration builds

All 16 rrweb workspace packages use `build: pnpm check-types && vite build && pnpm build:declarations`, with `check-types: tsc --noEmit`. This explicit semantic-check step must succeed before JavaScript or declaration generation starts. `build:declarations` only emits types; it is not a substitute for `check-types` or the production build.

The shared `packages/rrweb/rolldown.dts.config.mts` explicitly uses Oxc for all 16 packages, each of which enables `isolatedDeclarations` in its TSConfig. Exported declarations must have sufficient type annotations for isolated generation. Keep semantic checking enabled: Oxc does not replace TypeScript's type checker.

Declaration entries remain self-contained, external package imports remain external, and each `.d.ts` has an identical `.d.cts` sibling. Watch mode uses the same package Rolldown configs through `vite.declarations.ts`. Vite owns runtime and declaration rebuilds together, including type-only source dependencies; it emits the same self-contained declarations, CommonJS copies, secondary entrypoints, and canvas WebRTC shim as production. An incremental TypeScript program reports semantic errors on startup and source edits without stopping development; production `check-types` still blocks invalid builds. The checker shares Vite's watched files and creates no additional watcher or process. It checks the full TSConfig project on each rebuild; a newly created, unimported file is picked up on the next watched edit or restart.

Each rrweb `pnpm dev` first builds its dependencies through Turbo, then starts a single Vite watcher. Running `vite build --watch` directly assumes dependencies are already built. The alternate `pnpm dev --config vite.config.entries.js` in `packages/rrweb/rrweb` uses `rolldown.dts.entries.config.mts` for the record/replay entries. Restart development after editing build configuration. Declarations are generated in memory and emitted by Vite, so no second process races Vite's output cleanup.

```sh
pnpm turbo run build --filter='./packages/rrweb/**'
pnpm turbo run check-types --filter='./packages/rrweb/**'
pnpm test:rrweb-declarations
pnpm test:rrweb-dev-watch
pnpm test:rrweb-package-exports
pnpm test:rrweb-consumers
```

The watch suite builds its prerequisites and temporarily edits and restores rrweb sources to check startup, declaration parity, semantic diagnostics, rebuilds, and shutdown. Run it without other builds or watchers in the same worktree.

The installed-consumer tests build and pack their prerequisites. `test:rrweb-package-exports` checks JavaScript/CSS export targets and native Node ESM/CommonJS behavior. `test:rrweb-consumers` checks strict declarations with TypeScript 4.7, 5.8, and 6, including coexistence with consumer Node 22/24 typings. Both need registry access; the strict type checks retain their tarballs, installs, and compiler logs in a reported temporary directory.

The canvas WebRTC plugin ships its SimplePeer declaration shim and legacy-compatible Node typings for TypeScript 4.7 consumers. Its Vite development tools are provided by the private `tooling/rrweb-build` workspace so their modern typing peers remain separate from the published dependency. This type-only dependency does not change the workspace's Node 24 runtime requirement.

The declaration regression tests also run through `pnpm test:unit`. When changing an entrypoint, verify its package exports and both declaration formats, and check a `pnpm dev` source edit/rebuild. Keep the shared build configs in Turbo's cache inputs.

### Native TypeScript declarations

SDK builds use stable `typescript@7.0.2` for native compiler commands and compatible declaration backends, rather than `@typescript/native-preview`. Rslib selects the native backend from the installed TypeScript version. rrweb retains its Oxc declaration bundler and uses native TypeScript for semantic checks.

The JavaScript compiler remains only where existing tooling requires it:

- The root compiler supports documentation resolvers and programmatic compiler regression tests.
- `posthog-js` retains its ES5 emitter and compiler API. `@posthog/nuxt` retains the compiler API required by Nuxt's module builder.
- `@posthog/react` uses `typescript-legacy` only for its ES5 compatibility transform; declarations use native TypeScript.
- `@posthog/types` uses `typescript-legacy` for API introspection tests and the declaration-build baseline.
- `@posthog/mcp` uses `typescript-legacy` only for its NestJS integration harnesses, where `ts-node` needs the compiler API and decorator metadata emitter.
- `@posthog/browser` uses `typescript-legacy` for its full development type check because the pinned Playwright declarations contain syntax removed in TypeScript 7. Its production declaration build uses native TypeScript without test-only ambient types.
- Rollup utilities keep the JavaScript compiler for their exported TypeScript plugin, but compile themselves with the explicit `@typescript/native` alias. Their built-output test checks that the exported plugins still initialize.

`pnpm turbo run test:unit --filter=@posthog/types` includes a production-build regression check comparing all legacy and native compiler outputs, including declarations and source maps, and verifying that both builds fail on a deliberate semantic error. The test copies sources into a temporary fixture, explicitly links and verifies each compiler version, and leaves production outputs untouched. Compiler backend changes must preserve this compatibility check; isolated compiler speed alone does not establish production-build or consumer compatibility.

### Dead code audit (Knip)

[Knip](https://knip.dev/) is an opt-in local audit, not a lint or CI gate. After `pnpm install --frozen-lockfile`, run it from the repository root; no SDK build is required:

```bash
# Full audit, including dependencies
pnpm knip

# Focus on unused files, exports, and types
pnpm knip --include files,exports,types

# Focus on a workspace (Knip also follows related workspaces)
pnpm knip --workspace packages/browser

# Save machine-readable findings without pnpm's script banner
pnpm --silent knip --reporter json > /tmp/knip.json
```

Knip exits non-zero when it finds issues. Findings are review candidates, not proof that code can be deleted. The config excludes independent examples/playgrounds, preserves public SDK subpaths and dynamically discovered browser bundles, and ignores exports still used within their own file. Keep `knip.jsonc` in sync when adding public entry points that plugins cannot discover; do not enable `includeEntryExports` for published SDKs.

Before removing anything, check public/deep imports, dynamic loading, shared build configuration, test fixtures, and native tooling. Dependency reports still need particular care: shared Babel/Vite configuration and CLI binaries resolved at runtime can make required dependencies look unused. An unused re-export does not imply that its underlying implementation is dead. Do not run `--fix` or `--allow-remove-files` indiscriminately. Verify any cleanup with the affected packages' tests/builds and measure bundle size separately rather than assuming source deletion reduces shipped bytes.

### Package Scripts

Common package scripts are listed below. Availability and build output directories vary; check the package's `package.json` before running them:

- `clean` - Remove build artifacts
- `lint` - Lint all files for this package
- `lint:fix` - Fix linting issues
- `build` - Transpile, minify and/or bundle source code (usually into `dist/` or `lib/`)
- `check-types` - Check source types without emitting SDK JavaScript or declarations (all SDK and rrweb packages)
- `dev` - Build and watch for changes
- `test:unit` - Run unit tests; some packages still include built-output assertions
- `test:built` - Run dedicated built-output assertions (if available)
- `test:rrweb` - Run vendored rrweb suites, including real-browser and built-output tests
- `test:functional` - Run functional/integration tests (if applicable)
- `package` - Create a tarball of this package that can be installed inside an example or playground project

### Using Turbo to Target Specific Packages

You can run commands using the `turbo` CLI and target specific packages. Useful examples:

```bash
# Create tarballs for all packages in target/ (sets PACKAGE_DEST)
pnpm package

# Run unit tests for posthog-js only
pnpm turbo --filter=posthog-js test:unit

# Build posthog-react-native and its dependencies
pnpm turbo --filter=posthog-react-native build

# Lint a specific package
pnpm turbo --filter=@posthog/react lint
```

### Task dependency contracts

Use root scripts or `pnpm turbo run <task> --filter=<package>` to bootstrap prerequisites. Package build, type-check, test, and reference-generation scripts are leaf commands: running them directly assumes their required dependency outputs already exist. rrweb uses the same `build -> ^build` graph as the SDKs; there is no separate `prepublish` task graph. Its explicit standalone `build-and-test` and watch wrappers bootstrap dependencies through Turbo.

`pnpm test` schedules lint and test leaf tasks directly so package-level `test` convenience scripts do not run the same suites again. rrweb suites live under `test:rrweb`, outside the ordinary unit CI job. `pnpm test:unit` also schedules `test:built` to preserve built-output coverage; for a filtered equivalent, use `pnpm turbo run test:unit test:built --filter=<package>`.

Browser-next separates its source suite (`test:unit`, requiring dependency builds only) from its mixed-module delivery check (`test:built`, requiring its own build). Its `check-types` task also requires its own build because it includes package-consumer fixtures. Other packages retain their existing production-build prerequisites until their artifact checks are separated and verified. `pnpm test:build-graph` guards these ordering and coverage contracts with Turbo dry runs.

## Contract-based regression tests

Before changing reported behavior, identify the violated documented, type-level, or established runtime contract. A reproduction alone does not establish a bug: distinguish invalid usage from valid empty, disabled, or unavailable states. If the intended behavior is ambiguous, clarify it before changing the contract; follow the [public API process](#public-api-changes) when applicable.

Where feasible, demonstrate a regression test failing before the fix and passing afterward. The failure must exercise the reported behavior, not a missing dependency or broken test setup. Derive expected results independently of the implementation rather than copying its branches or using the same helper to compute the expectation. For SDK behavior, include relevant boundaries such as consent, identity/session transitions, retries, or runtime availability, without creating unrelated test infrastructure.

Explain the coverage gap that allowed the bug and how the regression test closes it. If before/after validation is not feasible, report why and what evidence was checked instead.

## Verification by change type

Use focused checks during iteration, then run the existing [CI-aligned checks](#ci-aligned-checks) before opening a PR. This table supplements those requirements; it does not exempt a change from them. Rows are cumulative when a change crosses boundaries.

Run root commands from the repository root after the documented environment setup. Use Turbo to build prerequisites; direct package commands assume dependency outputs already exist. Check the affected package's scripts and contributor guide for its test runner and additional checks.

| Change type                                               | Focused verification                                                                                                                                                                                                                                           | Coverage limits and setup                                                                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK runtime or tests                                      | `pnpm turbo run test:unit test:built check-types --filter=<package>` and affected functional/browser tests                                                                                                                                                     | Unit tests alone do not establish built-output, browser, or live-service behavior. Run the affected package's lint checks as well.                                                                                                                    |
| Public API, exports, declarations, or build configuration | Affected package build and semantic checks, available `test:built` checks, and installed-consumer validation using [local tarballs](#running-an-example-or-playground-project-with-local-changes)                                                              | Inspect exports and both runtime and type consumption. For supported SDKs, run `pnpm generate-references` and inspect the diff; reference generation is not API approval. For rrweb, use the declaration/export/consumer checks below.                |
| rrweb source, entrypoints, or declaration builds          | `pnpm test:rrweb`; for entrypoint/declaration changes, the checks in [rrweb declaration builds](#rrweb-declaration-builds), including exports, consumers, and watch rebuilds                                                                                   | Ordinary unit checks do not replace rrweb browser suites. Browser tests require Puppeteer's Chrome; consumer tests require registry access. Run source-editing watch tests without other builds or watchers.                                          |
| Browser compatibility, polyfills, or bundle transforms    | Build `posthog-js`, then `pnpm exec es-check es5 packages/browser/dist/array.full.es5.js` and `pnpm exec es-check es6 packages/browser/dist/array.full.js`; run the relevant built-bundle tests in `packages/browser/src/__tests__/entrypoints/module.test.ts` | Syntax checks cannot detect missing runtime built-ins. Follow the [browser agent guide](packages/browser/AGENTS.md) for the built-in availability canary and the [browser contributor guide](packages/browser/CONTRIBUTING.md) for browser/E2E setup. |
| Browser DOM, storage, consent, or session behavior        | Affected package's real-browser tests in addition to unit tests                                                                                                                                                                                                | For `posthog-js`, use the non-interactive [Playwright command](#playwright). For `@posthog/browser`, follow its [agent guide](packages/browser-next/AGENTS.md), including cross-browser storage/session checks.                                       |
| Turbo task ordering or build prerequisites                | `pnpm test:build-graph` plus the affected task from an environment without stale prerequisite outputs                                                                                                                                                          | A dry-run graph alone does not prove compiled artifacts or consumers work.                                                                                                                                                                            |
| Documentation or agent instructions                       | Check Markdown formatting, local links, and commands against their owning manifests/guides                                                                                                                                                                     | If executable examples, source, or configuration change, also apply the relevant rows above.                                                                                                                                                          |

In the final validation report, give the commands and scope checked, distinguishing **passed**, **failed**, **skipped** (with the reason), and **not run**. Missing credentials or dependencies are not evidence that a check passed. State remaining coverage gaps, including any pre-PR checks not run.

## Generated outputs and their owners

Change the owning source or generator, then regenerate; do not patch generated output to hide a source problem. These guards apply to the listed outputs, not every JSON file, declaration, or directory named `lib`.

| Generated output                                                                                                                                                                                                | Editable owner                                                                                                                                       | Regeneration from the repository root                   | Commit policy                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/browser/references/posthog-js-references-latest.json`, `packages/node/references/posthog-node-references-latest.json`, `packages/react-native/references/posthog-react-native-references-latest.json` | The corresponding SDK's public TypeScript declarations/JSDoc in source, API Extractor config, and `scripts/generate-docs.*` generator                | `pnpm generate-references` (Turbo builds prerequisites) | These files are tracked. Include relevant regenerated changes and inspect signature/type/member changes under the public API process; do not hand-edit the JSON. |
| Browser `packages/browser/lib/` and `packages/browser/dist/`, including emitted/bundled declarations                                                                                                            | `packages/browser/src/` and its compiler/bundler configuration                                                                                       | `pnpm turbo run build --filter=posthog-js`              | Ignored build outputs; do not force-add them. Hand-maintained declaration inputs outside these outputs remain editable.                                          |
| rrweb package `dist/` outputs, including `.d.ts` and `.d.cts` siblings                                                                                                                                          | The owning rrweb package's source and the shared build/declaration configurations described in [rrweb declaration builds](#rrweb-declaration-builds) | `pnpm turbo run build --filter='./packages/rrweb/**'`   | Ignored build outputs; do not force-add them. Validate declaration parity and installed consumers rather than hand-patching emitted types.                       |
| `target/*.tgz`                                                                                                                                                                                                  | Package sources, build configuration, and package manifests controlling published files                                                              | `pnpm build` followed by `pnpm package`                 | Ignored local consumer artifacts; do not commit them. Reinstall tarballs in consumers after rebuilding.                                                          |

For other outputs, inspect the owning package scripts, tracked files, and ignore rules before deciding how to regenerate or whether to commit them. Review regeneration diffs and report unexpected unrelated drift rather than silently including it.

## CI-aligned checks

Run these commands from the repository root before opening a PR:

```sh
pnpm build
pnpm check-types
pnpm lint
pnpm lint:playground
pnpm test:unit
pnpm test:functional
```

These are the main build, lint, and test commands used by CI for the monorepo.

### Playwright

For non-interactive or agent-run Playwright tests, run from `packages/browser` and prefer the line reporter:

```bash
cd packages/browser
pnpm exec playwright test --reporter=line
```

The default HTML reporter serves the report and waits after local failures, which can make the command appear stuck. Add test paths and `--project` filters before `--reporter=line` for focused runs.

## Running an Example or Playground Project with Local Changes

Check out the [`examples`](examples/README.md) directory for usage examples.

The recommended workflow for testing local changes uses tarballs, which most realistically simulates how packages are installed from npm:

### One-Time Setup

1. Run `pnpm build` followed by `pnpm package` at the repository root to generate tarballs in `./target`. Build first because the `posthog-js` package task does not build its own browser output.
2. Navigate to the example/playground project: `cd examples/example-nextjs`
3. Check its `pnpm-workspace.yaml` for the shared pnpmfile. Without that hook, point dependencies at the tarballs, for example `"posthog-js": "file:../../target/posthog-js.tgz"`.
4. Run `pnpm install` to install local tarballs.
5. Run `pnpm dev` or `pnpm start` to start the project.

### Development Workflow (Recommended)

1. **Terminal 1** (root): Run `pnpm package:watch` - auto-regenerates tarballs on changes
2. **Terminal 2** (example project): Navigate to example folder
3. Make changes to SDK source code. For browser SDK changes, also rebuild `posthog-js` or run its `dev` script so the tarball includes updated output.
4. Re-run `pnpm install` in the example project to pick up new tarballs
5. Restart the example project

## Code Style and Linting

### Oxlint

- `pnpm lint` runs formatting checks, the root correctness pass (`.oxlintrc.correctness.json`), and package lint scripts.
- Package linting uses `.oxlintrc.json`, including the custom `oxlint-plugin-posthog-js` rules and TypeScript, React, Jest, and browser compatibility rules.
- Run `pnpm lint:playground` separately for the top-level playground projects.

### Automatic Formatting

Oxfmt checks workspace package code during linting. Pre-commit hooks (via prek) automatically lint and format staged TypeScript and JavaScript files, and format staged JSON and Markdown files.

## Public API changes

Public API is hard to change once it ships, so agree on its intended shape before implementing an unsolicited addition or change. Our [SDK guidelines](https://posthog.com/handbook/engineering/sdks/guidelines) explain how we design it.

The PR is where we agree on API shape for work a maintainer already requested, so a separate issue is not needed. Reviews and investigations do not require an issue and should proceed regardless of whether one exists. For coding agents, an explicit human request authorizes the requested API change, not unrelated API additions. Propose any API changes outside the requested scope before implementing them, in the PR description or your response if no PR exists, and let the human decide whether an issue is needed. Agents must not open issues automatically.

- **Before you start an unsolicited API change:** external contributors proposing a new or changed public option, method, or exported type should open an issue describing the use case and agree on the API shape with a maintainer before implementing it. This issue-first guidance does not block reviews, investigations, or explicitly requested agent work. Context is more useful to us than code at this stage.
- **Already have a PR open?** Call out the public API change and its rationale at the top of the PR description. Link an existing discussion if available; do not stop or rewrite the work solely because there is no issue. A maintainer can decide whether a separate discussion is useful.
- Check first whether an existing option or hook, such as `before_send`, already covers the use case. We avoid offering two ways to do the same thing.
- If a reviewer suggests a different API on your PR, confirm it with them before re-implementing. Treat it as a question, not an instruction.

`pnpm generate-references` regenerates the API references for `posthog-js`, `posthog-node`, and `posthog-react-native`. Treat its diff as a signal to inspect, not a verdict: a changed signature, type, or member in a `*-references-latest.json` file usually means your change touches public API, while descriptions, examples, and source paths change without it. For other packages, check what the package exports.

## Opening a new PR

- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) format.
- Examples: `feat:`, `fix:`, `chore:`, `docs:`.
- Validated by the `lint-pr.yml` workflow.

Follow [RELEASING.md](./RELEASING.md) for changeset requirements and writing guidance, publishing, and recovery procedures.

## CI/CD

### Key GitHub Actions Workflows

| Workflow                  | Purpose                                                  | Trigger                                                   |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `library-ci.yml`          | Main testing pipeline (unit + E2E tests)                 | PR + Push to main                                         |
| `release.yml`             | Publishes browser assets and npm packages after approval | Push to main affecting `.changeset/**`; workflow dispatch |
| `integration.yml`         | Playwright tests across browsers                         | PR                                                        |
| `lint-pr.yml`             | Validates PR titles (Conventional Commits)               | PR events                                                 |
| `es-check.yml`            | Validates ES5/ES6 bundle compatibility                   | PR + Push to main                                         |
| `bundled-size.yaml`       | Monitors bundle size changes                             | PR                                                        |
| `generate-references.yml` | Generates API documentation                              | Workflow dispatch                                         |

### CI credentials and restricted PRs

Set workflow-level `permissions: {}` and grant `GITHUB_TOKEN` permissions explicitly on each job, including reusable-workflow callers. Build-only jobs should use `contents: read`; jobs that do not use the GitHub API or checkout should use `permissions: {}`. Grant write permissions and `id-token: write` only to jobs that need them. These settings do not restrict GitHub App tokens or other secrets, and every step in a privileged job shares its token permissions.

Fork and Dependabot PRs may not have repository secrets, and their default `GITHUB_TOKEN` can be read-only. A same-repository PR is not proof that credentials are available.

- `integration.yml` checks `POSTHOG_API_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_PROJECT_API_KEY`, and `POSTHOG_PERSONAL_API_KEY` before checkout, dependency installation, builds, or live tests.
- `testcafe.yml` checks both `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` and both PostHog API keys before setup, browser sessions, or event polling. Its PostHog host and project ID have defaults in the test helper.
- `dependabot-changeset.yml` checks both GitHub App credentials before token creation or checkout. When unavailable, add any required changeset manually.

These optional credential-dependent jobs succeed with an explicit skip notice when required values are missing. Never print credential values or turn authentication errors, network errors, or test failures into success when credentials are present. Keep fork guards; do not use `pull_request_target` to give PR code access to secrets.

Bundle-size, compatibility, incident-risk, description, and versioning checks skip PR comment operations for forks and Dependabot while retaining their local checks and reports. The shared feature-flags project-board workflow already excludes fork and Dependabot PRs.

The main unit, functional, local Playwright, MCP, SDK compliance, and native plugin checks do not require live API credentials. AI live-provider tests already skip without their respective `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Next.js CI smoke builds use dummy configuration and disable real sourcemap uploads.

Publishing, S3 recovery, reference-generation, downstream-upgrade, and watcher worker/sweep workflows run in trusted push, manual, or scheduled contexts rather than untrusted PR test jobs. Their required GitHub App, AWS/OIDC, Slack, and OpenAI configuration must not be bypassed to make a release or automation run appear successful.

### CI egress auditing

Credential-bearing GitHub-hosted Ubuntu jobs run the SHA-pinned `step-security/harden-runner` action as their first step, before checkout, dependency installation, or token creation. Coverage includes jobs with write-capable `GITHUB_TOKEN` permissions, OIDC access, GitHub App credentials, or service secrets, including secrets used only in failure notifications. Read-only jobs without service secrets are intentionally outside this rollout.

The initial policy is `egress-policy: audit`. It reports network activity to StepSecurity but does not enforce a job-specific outbound allowlist. Audit mode requires StepSecurity telemetry; review the service's data handling before adding sensitive destinations. Do not interpret a successful audit step as proof that exfiltration is prevented, and do not add token permissions just for auditing.

Before enabling `egress-policy: block` for a job:

1. Review the report linked from the job summary after representative successful runs, including cold dependency downloads, matrix variants, and relevant failure/recovery paths. Do not trigger a production release solely to collect a baseline.
2. Review every observed destination and commit a narrow `allowed-endpoints` list for that job. Do not automatically approve unexplained traffic or share publishing destinations with unrelated build jobs.
3. Verify required traffic succeeds and an unlisted destination is blocked in a disposable, credential-free job on the same runner type before using the policy with real credentials.

The following credential-bearing jobs are not covered by this setup:

| Jobs                                                                                                      | Reason and follow-up                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration.yml` / `browsers`                                                                            | Runs in a job container. Harden-Runner does not support this layout on standard GitHub-hosted runners. Move enforcement to a supported host or runner image.                                                           |
| `library-ci.yml` / `compat`                                                                               | Uses Depot and a job container. Verify provider-level enforcement or a supported agent deployment separately.                                                                                                          |
| Feature Flags project board, changeset hygiene, release approval notification, and SDK compliance callers | Their steps live in pinned reusable workflows in `PostHog/.github` or `PostHog/posthog-sdk-test-harness`. Add monitoring there, then update the caller pins. A caller cannot prepend steps to a reusable workflow job. |

The local S3 recovery reusable workflow is covered inside its credential-bearing jobs. macOS native builds currently have no declared service secrets or write permissions and remain outside this rollout. Hosted macOS/Windows monitoring does not provide the same blocking support as hosted Linux. See the [Harden-Runner compatibility matrix](https://github.com/step-security/harden-runner#environment-compatibility-matrix) and [limitations](https://github.com/step-security/harden-runner/blob/main/docs/limitations.md) before expanding coverage.

Network auditing or blocking does not replace least-privilege tokens or build/publish separation. An allowed destination such as the GitHub API can still be abused with a stolen token.

## Configuration Files

- `package.json` - Root workspace scripts and dependencies
- `pnpm-workspace.yaml` - Workspace definition and version catalogs
- `turbo.json` - Build orchestration and task caching
- `.nvmrc` - Node version specification
- `.oxlintrc.json` - Oxlint configuration, including package-specific overrides
- `.oxlintrc.correctness.json` - Root correctness lint pass
- `.oxfmtrc.json` - Oxfmt configuration
- `prek.toml` - Pre-commit lint/format hooks and pre-push branch protection
- `.changeset/config.json` - Changesets versioning and changelog configuration

## Troubleshooting

### Build Issues

```bash
# Clean all build artifacts
pnpm clean

# Clean all node_modules
pnpm clean:dep

# Reinstall dependencies
pnpm install

# Rebuild everything
pnpm build
```

### Tarball Issues

```bash
# Rebuild outputs and regenerate all tarballs
pnpm build
pnpm package

# In the example project, reinstall dependencies
pnpm install --force
```

### Test Failures

```bash
# For packages whose test:unit script runs Vitest, use its verbose reporter
pnpm turbo --filter=<package-name> test:unit -- --reporter=verbose

# Update Vitest snapshots if needed
pnpm turbo --filter=<package-name> test:unit -- -u
```

## Additional Resources

- [Project Overview](./README.md)
- [PostHog Documentation](https://posthog.com/docs)
- [Release Process](./RELEASING.md)
- [Issue Tracker](https://github.com/PostHog/posthog-js/issues)
