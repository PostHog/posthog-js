# Browser package instructions

Root [AGENTS.md](../../AGENTS.md) applies. Read the root [CONTRIBUTING.md](../../CONTRIBUTING.md) and this package's [CONTRIBUTING.md](./CONTRIBUTING.md).

## Runtime and build safeguards

- Preserve consent/opt-out and privacy behavior across capture, persistence, and extensions.
- Eligible captures use the batching queue; unbatched/immediate captures bypass it. Preserve both queued and direct/retriable delivery paths.
- In browser source covered by the custom lint rules, use `@posthog/core` helpers such as `isArray`, `isNull`, and `isUndefined` rather than native checks. Respect file-specific overrides in the root `.oxlintrc.json`, especially Playwright's array/null/undefined exemptions.
- Keep extension UI on the configured Preact JSX runtime; React bindings belong to the separate React package.
- Preserve TypeScript semantic checking/declaration generation, canonical PostHog type references, and published declaration paths. Preserve cross-bundle private-property ABI, reserved names, and source-map names required by the postbuild checker; see [build constraints](./CONTRIBUTING.md#private-property-abi-and-declarations).
- Keep ES5/old-browser compatibility safeguards: syntax checks do not establish built-in availability. Preserve the built web-vitals polyfill canary in `src/__tests__/entrypoints/module.test.ts` and IE11 TestCafe wrapper targets; see [compatibility details](./CONTRIBUTING.md#old-browser-syntax-and-built-ins).

## Focused validation

- Bootstrap the full browser unit suite through root Turbo (for example, `pnpm turbo run test:unit test:built --filter=posthog-js` from the repository root). It requires browser, dependency, and React outputs and reads `dist`; direct package commands assume prerequisites exist. Rebuild stale artifacts.
- For iteration, select a source test that does not read built outputs. From `packages/browser`, run `pnpm exec vitest run src/path/to/test.test.ts`.
- From `packages/browser`, run focused Playwright tests with `pnpm exec playwright test path/to/test.spec.ts --reporter=line`. UI commands are intentionally interactive.
- Follow the package [testing guide](./CONTRIBUTING.md#testing) for relevant compatibility/build/packaging/live checks and the root [CI-aligned checks](../../CONTRIBUTING.md#ci-aligned-checks) for final validation; focused tests do not replace them.
