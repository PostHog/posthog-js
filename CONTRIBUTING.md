# Contributing

## Overview

This is a pnpm monorepo containing multiple PostHog JavaScript SDKs and development tooling. The repository uses Turbo for build orchestration and supports local development through tarball-based testing.

**Key Information:**

- Development Node Version: `24.x` (see `.nvmrc` and `package.json`)
- Package Manager: `pnpm@11.7.0` (see `package.json`)
- TypeScript Catalog Version: `5.8.2` (see `pnpm-workspace.yaml`; individual packages may use other compilers)
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

### rrweb declaration builds

All 16 rrweb workspace packages use `build: pnpm check-types && vite build && pnpm build:declarations`, with `check-types: tsc --noEmit`. This explicit semantic-check step must succeed before JavaScript or declaration generation starts. `build:declarations` only emits types; it is not a substitute for `check-types` or the production build.

The shared `packages/rrweb/rolldown.dts.config.mts` explicitly uses Oxc for all 16 packages, each of which enables `isolatedDeclarations` in its TSConfig. Exported declarations must have sufficient type annotations for isolated generation. Keep semantic checking enabled: Oxc does not replace TypeScript's type checker.

Declaration entries remain self-contained, external package imports remain external, and each `.d.ts` has an identical `.d.cts` sibling. Watch mode uses Vite's declaration plugin except for `rrweb-record`, which runs a separate Rolldown declaration watcher. The alternate rrweb entrypoint config also retains Vite's declaration plugin.

```sh
pnpm turbo run build --filter='./packages/rrweb/**'
pnpm turbo run check-types --filter='./packages/rrweb/**'
pnpm test:rrweb-declarations
```

The declaration regression tests also run through `pnpm test:unit`. When changing an entrypoint, verify its package exports and both declaration formats, and check a `pnpm dev` source edit/rebuild. Keep the shared build configs in Turbo's cache inputs.

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

## CI-aligned checks

Run these commands from the repository root before opening a PR:

```sh
pnpm build
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
