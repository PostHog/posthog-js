## Installation

At the root of the project, run:
```shell
pnpm install
```
This will install all the workspace dependencies.

## Development

Go to the `packages` directory and run:
```shell
turbo dev
```
It will watch for changes and rebuild the packages.

## Testing

To run tests for a specific package, navigate to the package directory and run:
```shell
turbo test
```

or from the root of the project, run:
```shell
turbo --filter=<package-name> test
```

## Building

Go to the `packages` directory and run:
```shell
turbo build
```
This will rebuild all packages, this package depends on.

## Releases

Releases are managed with changeset, you can find more information on the [changeset repository](https://github.com/changesets/changesets).

Before submitting a PR, run:
```
pnpm changeset
```

CLI will prompt questions about the changes you've made and will generate a changeset file for you.
