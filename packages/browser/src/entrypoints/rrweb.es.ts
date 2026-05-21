// Re-exports the full @posthog/rrweb package (record + replay + utils) so
// downstream consumers of posthog-js do not have to depend on the underlying
// @posthog/rrweb package directly. The rrweb workspace package is bundled
// into dist/rrweb.js by rollup at build time and shipped inside the
// posthog-js npm tarball. The matching package.json that maps the
// `posthog-js/rrweb` subpath lives at packages/browser/rrweb/package.json.
export * from '@posthog/rrweb'
