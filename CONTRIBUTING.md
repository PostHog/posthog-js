## Tooling
- Install [corepack](https://github.com/nodejs/corepack), if it's not already the case
- Install [nvm](https://github.com/nvm-sh/nvm), if it's not already the case

At the root folder, run :
```
nvm use
```

## Installation

At the root of the project, run:
```shell
pnpm install
```
This will install all the workspace dependencies.

## Development

Go to the `packages` directory and run:
```shell
pnpm dev
```
It will watch for changes and rebuild the packages.

## Testing

To run tests for a specific package, navigate to the package directory and run:
```shell
pnpm test
```

or from the root of the project, run:
```shell
pnpm --filter=<package-name> test
```

## Building

From the root folder, run:
```shell
pnpm build
```
This will build all packages, by taking dependencies into account.

## Examples

Check out the [`examples`](examples/README.md) directory for usage examples.

## Releases

Releases are managed with changeset, you can find more information on the [changeset repository](https://github.com/changesets/changesets).

Before submitting a PR, create a changeset by running:
```
pnpm changeset
```

CLI will prompt questions about the changes you've made and will generate a changeset file for you.

Add a `release` label to your PR to publish automatically your changes when it's merged.
