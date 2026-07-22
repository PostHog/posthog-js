// ES module entrypoint backing the `posthog-js/customizations` subpath, so
// consumers can import customizations without reaching into the tsc build
// output (`posthog-js/lib/src/customizations`), which is CJS-only and does not
// resolve under native ESM or Node16 module resolution.
export * from '../customizations'
