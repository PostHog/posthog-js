// The rrweb workspace packages are never published to npm, so the npm build bundles them into this module, as
// posthog-js bundles them into its recorder.
export { record } from '@posthog/rrweb-record'
export { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
