# Contributing

## Tooling

- Install [corepack](https://github.com/nodejs/corepack), if it is not already available
- Install [nvm](https://github.com/nvm-sh/nvm), if it is not already available

At the repository root, run:

```sh
nvm use
pnpm install --frozen-lockfile
```

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

## Development

Run watch mode from the repository root:

```sh
pnpm dev
```

## Package-specific guides

Some packages have their own contributor guides with extra package-level checks:

- [packages/browser/CONTRIBUTING.md](packages/browser/CONTRIBUTING.md)
- [packages/react-native/CONTRIBUTING.md](packages/react-native/CONTRIBUTING.md)
- [packages/convex/CONTRIBUTING.md](packages/convex/CONTRIBUTING.md)
- [packages/nuxt/CONTRIBUTING.md](packages/nuxt/CONTRIBUTING.md)

## Opening a new PR

Check [RELEASING.md](RELEASING.md) to understand how we use [changesets](https://github.com/changesets/changesets) to power our release process.

## Examples

Check out the [`examples`](examples/README.md) directory for usage examples.
