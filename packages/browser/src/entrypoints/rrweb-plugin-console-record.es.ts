// Re-exports the @posthog/rrweb-plugin-console-record package so downstream
// consumers of posthog-js can import the console-record plugin (and its
// LogLevel enum) via `posthog-js/rrweb-plugin-console-record` instead of
// depending on the underlying workspace package directly. The sibling
// package.json that maps the subpath lives at
// packages/browser/rrweb-plugin-console-record/package.json.
export * from '@posthog/rrweb-plugin-console-record'
