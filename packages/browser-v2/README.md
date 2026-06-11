# PostHog Browser JS Library v2 (`@posthog/browser`)

> **Status: pre-alpha, not published.** This is the v2 line of the PostHog browser SDK, seeded as a copy of [`packages/browser`](../browser) (`posthog-js` v1.386.0). v1 remains fully supported and is developed independently in `packages/browser`.
>
> v2 goals: camelCase API and config, no deprecated surface, explicit modern-browser support (no ES5), async-native public API, and (later) dynamic loading of optional features.

For information on using the v1 library in your app, [see PostHog Docs](https://posthog.com/docs/libraries/js).
This README is intended for developing the library itself.

## Dependencies

We use pnpm.

It's best to install using `npm install -g pnpm@latest-9`
and then `pnpm` commands as usual

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for package-specific testing and local linking instructions.
