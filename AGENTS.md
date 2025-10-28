# PostHog JS SDK Development Guide

## Overview

This is a pnpm monorepo containing multiple PostHog JavaScript SDKs and development tooling. The repository uses Turbo for build orchestration and supports local development through tarball-based testing.

**Key Information:**

- Node Version: `v22.17.1` (see `.nvmrc`)
- Package Manager: `pnpm@10.12.4`
- TypeScript Version: `5.8.2`
- Main Branch: `main`

## Folder Structure

- `./packages` - All JS SDKs that are distributed as npm packages (9 packages)
- `./playground` - Projects to test packages locally during development
- `./examples` - Simple example projects demonstrating how to install and use our SDKs
- `./target` - Generated tarballs for SDK packages (created by `pnpm package`)
- `./tooling` - Shared development packages (ESLint plugin, Rollup utils, TSConfig base)
- `./.github` - CI/CD workflows and custom GitHub Actions

## SDK Packages

The repository contains the following SDK packages in `./packages/`:

| Package          | Name                     | Description                                     |
| ---------------- | ------------------------ | ----------------------------------------------- |
| `browser/`       | `posthog-js`             | Main browser SDK for capturing events and usage |
| `web/`           | `posthog-js-lite`        | Lightweight browser SDK                         |
| `core/`          | `@posthog/core`          | Shared core functionality used by multiple SDKs |
| `node/`          | `posthog-node`           | Node.js backend SDK (requires Node >= 20)       |
| `react/`         | `@posthog/react`         | React components and hooks                      |
| `react-native/`  | `posthog-react-native`   | React Native mobile SDK                         |
| `nuxt/`          | `@posthog/nuxt`          | Nuxt framework module                           |
| `nextjs-config/` | `@posthog/nextjs-config` | Next.js configuration helper                    |
| `ai/`            | `@posthog/ai`            | AI integrations for Node.js                     |

## Workspace

- This repository is structured as a pnpm workspace and each SDK and tooling package is a member of this global workspace.
- Example and playground projects are independent pnpm workspaces. You can install their dependencies by running `pnpm install` inside the specific project folder. All dependencies and sub-dependencies to PostHog SDKs will be overwritten using a pnpmfile.

## Environment Setup

```bash
# Use the correct Node version
nvm use

# Install all workspace dependencies
pnpm install
```

## Commands

### Root-Level Scripts

Run these from the repository root:

```bash
# Build all packages (respects dependency order)
pnpm build

# Watch mode for development
pnpm dev

# Run all tests across packages
pnpm test

# Run unit tests only
pnpm test:unit

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

### Package Scripts

All SDK packages have the following scripts:

- `clean` - Remove build artifacts
- `lint` - Lint all files for this package
- `lint:fix` - Fix linting issues
- `build` - Transpile, minify and/or bundle source code from ./src to ./dist
- `dev` - Build and watch for changes
- `test:unit` - Run unit tests
- `test:functional` - Run functional/integration tests (if applicable)
- `package` - Create a tarball of this package that can be installed inside an example or playground project

### Using Turbo to Target Specific Packages

You can run commands using the `turbo` CLI and target specific packages. Useful examples:

```bash
# Create tarballs for all packages
pnpm turbo package

# Run unit tests for posthog-js only
pnpm turbo --filter=posthog-js test:unit

# Build posthog-react-native and its dependencies
pnpm turbo --filter=posthog-react-native build

# Lint a specific package
pnpm turbo --filter=@posthog/react lint:fix
```

## Running an Example or Playground Project with Local Changes

The recommended workflow for testing local changes uses tarballs, which most realistically simulates how packages are installed from npm:

### One-Time Setup

1. Run `pnpm turbo package` inside the root folder to generate tarballs in `./target`
2. Navigate to the example/playground project: `cd examples/example-nextjs`
3. Run `pnpm install` (remove `pnpm-lock.yaml` if it exists) to install local tarballs
4. Run `pnpm dev` or `pnpm start` to start the project

### Development Workflow (Recommended)

1. **Terminal 1** (root): Run `pnpm package:watch` - auto-regenerates tarballs on changes
2. **Terminal 2** (example project): Navigate to example folder
3. Make changes to SDK source code - tarballs update automatically
4. Re-run `pnpm install` in the example project to pick up new tarballs
5. Restart the example project

## Build Configuration

Turbo handles build orchestration and ensures packages are built in the correct dependency order.

## Code Style and Linting

### ESLint

- Custom `eslint-plugin-posthog-js` for repository-specific rules
- TypeScript support
- React support
- Prettier integration

### Automatic Formatting

Pre-commit hooks (via lint-staged) automatically format code on commit:

- TypeScript/JavaScript files: ESLint + Prettier
- JSON/Markdown files: Prettier

## Release Process

This repository uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

### Creating a Changeset

Before submitting a PR with changes that should be released:

```bash
# Interactive CLI to create a changeset
pnpm changeset
```

This will:

1. Prompt you to select which packages are affected
2. Ask for the version bump type (major/minor/patch)
3. Request a description of the change
4. Create a file in `.changesets/` directory

### Publishing

1. Add the `release` label to your PR
2. When the PR is merged to `main`, the `release.yml` GitHub Action will:
    - Update package versions
    - Update CHANGELOG files
    - Publish to npm
    - Create GitHub releases

## CI/CD

### Key GitHub Actions Workflows

| Workflow                  | Purpose                                    | Trigger           |
| ------------------------- | ------------------------------------------ | ----------------- |
| `library-ci.yml`          | Main testing pipeline (unit + E2E tests)   | PR + Push to main |
| `release.yml`             | Publishes to npm and creates releases      | Push to main      |
| `integration.yml`         | Playwright tests across browsers           | PR                |
| `lint-pr.yml`             | Validates PR titles (Conventional Commits) | PR events         |
| `es-check.yml`            | Validates ES5/ES6 bundle compatibility     | PR                |
| `bundled-size.yaml`       | Monitors bundle size changes               | PR                |
| `generate-references.yml` | Generates API documentation                | Push to main      |

### PR Requirements

- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) format
- Examples: `feat:`, `fix:`, `chore:`, `docs:`
- Validated by `lint-pr.yml` workflow

## Important Files for Agents

### Configuration Files

- `package.json` - Root workspace scripts and dependencies
- `pnpm-workspace.yaml` - Workspace definition and version catalogs
- `turbo.json` - Build orchestration and task caching
- `.nvmrc` - Node version specification
- `.eslintrc.cjs` - ESLint configuration
- `.prettierrc` - Code formatting rules

### Documentation

- `CONTRIBUTING.md` - Contribution guidelines
- `AGENTS.md` - This file - agent development guide
- `RELEASING.md` - Detailed release process
- `README.md` - Project overview

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
# Regenerate all tarballs
pnpm package

# In example project, force reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Test Failures

```bash
# Run tests with verbose output
pnpm turbo --filter=<package-name> test:unit -- --verbose

# Update snapshots if needed
pnpm turbo --filter=<package-name> test:unit -- -u
```

## Additional Resources

- [PostHog Documentation](https://posthog.com/docs)
- [Contributing Guide](./CONTRIBUTING.md)
- [Release Process](./RELEASING.md)
- [Issue Tracker](https://github.com/PostHog/posthog-js/issues)
