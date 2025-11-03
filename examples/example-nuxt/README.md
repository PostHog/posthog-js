# PostHog Nuxt module Example

This interactive example demonstrates error tracking capabilities of PostHog's Nuxt module.

## How to run

1. Run `pnpm i` in the repo root.
2. Run `pnpm build` in the repo root.
3. Run `pnpm package` in the repo root.
4. Run `pnpm i` inside this package.
5. Run `pnpm build` inside this package.
6. Run `node .output/server/index.mjs` inside this package

Now you can either visit `localhost:3000` and press buttons to throw frontend errors or visit `localhost:3000/error` to throw a nitro error
