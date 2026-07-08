# Contributing

This guide covers package-specific development for `@posthog/convex`.

For repository-wide setup, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Development

From the repository root:

```sh
pnpm i
pnpm dev
```

## Regenerating `_generated/` files

The files in `src/component/_generated/` (`api.ts`, `component.ts`, `dataModel.ts`, `server.ts`) are produced by `npx convex codegen` against this component's `convex.config.ts`. When you change env-var declarations, function signatures, schema fields, or anything else `_generated/` types depend on, run:

```sh
pnpm build:codegen
```

On a fresh checkout this bootstraps a Convex local-only dev deployment (no Convex cloud account required) and writes a `.env.local`. Subsequent runs reuse it. The bootstrap's push step intentionally fails (the example-convex app reads env vars at module load that we don't set here), but `.env.local` is written first so codegen on the next step still works. Both `.env.local` and the local deployment data are gitignored. Commit the regenerated `_generated/` files alongside your other changes.

## Pull requests

PRs are welcome. Follow the repository contributing guide for general workflow expectations.
