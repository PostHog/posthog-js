export type { TraceparentTargets, TracingHeadersHostnames } from '@posthog/browser-common/utils/tracing-headers'

/**
 * Allow a provider so headers use the current distinct ID after bootstrap,
 * identify(), reset(), or other identity changes without re-patching fetch/XHR.
 */
export type TracingHeadersDistinctId = string | (() => string | undefined)
