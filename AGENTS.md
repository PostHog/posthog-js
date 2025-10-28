# PostHog JS SDK Development Guide

## Folder structure

- `./packages` contains all our JS SDKs that are distributed as npm packages.
- `./playground` contains projects to test packages locally
- `./examples` contains simple projects to demonstrate how to install and use our SDKs
- `./target` contains tarballs for SDK packages
- `./tooling` contains packages to simplify development and / or configure projects

## Workspace

- This repository is structured as a pnpm workspace and each SDK and tooling package is a member of this global workspace.
- Example and playground projects are independent pnpm workspaces. You can install their dependencies by running `pnpm install` inside the specific project folder. All dependencies and sub-dependencies to PostHog SDKs will be overwritten using a pnpmfile.

## Commands

All SDK packages have the following scripts:

- `clean` - Remove build artifacts
- `lint` - Lint all files for this package
- `lint:fix` - Fix linting issues
- `build` - Transpile, minify and/or bundle source code from ./src to ./dist
- `dev` - Build and watch for changes
- `test:unit` - Run unit tests
- `package` - Create a tarball of this package that can be installed inside an example or playground project

You can run those commands using the `turbo` CLI and target specific packages. Useful examples:

- Create tarballs for all packages: `pnpm turbo package`
- Run unit tests for posthog-js: `pnpm turbo --filter=posthog-js test:unit`
- Build posthog-react-native and its dependencies: `pnpm turbo --filter=posthog-react-native build`

## Running an example or playground project with local changes

- Run `pnpm turbo package` inside the root folder to generate tarballs
- Run `pnpm install` inside the project (remove pnpm-lock.yaml if it exists) to install local tarballs
- Run `pnpm dev` or `pnpm start` to start the project
