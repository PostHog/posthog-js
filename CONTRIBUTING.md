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

## Building

From the root folder, run:

```shell
pnpm build
```

This will build all packages, by taking dependencies into account.

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

## Opening a new PR

Check [RELEASING.md](RELEASING.md) to understand how we use [changesets](https://github.com/changesets/changesets) to power our release process.

## Examples

Check out the [`examples`](examples/README.md) directory for usage examples.
