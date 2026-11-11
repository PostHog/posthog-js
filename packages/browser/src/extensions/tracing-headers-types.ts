/**
 * Public config is `string[]` today. Keep `boolean` internally because the
 * earliest browser-only `__add_tracing_headers` preview option shipped as a
 * boolean, where `true` meant "add tracing headers to every request".
 */
export type TracingHeadersHostnames = string[] | boolean | undefined

/**
 * Allow a provider so headers use the current distinct ID after bootstrap,
 * identify(), reset(), or other identity changes without re-patching fetch/XHR.
 */
export type TracingHeadersDistinctId = string | (() => string | undefined)

/**
 * Hostnames or origins that may receive a W3C `traceparent` header. The array is
 * mutated in place on config changes so installed fetch/XHR patches see updates.
 */
export type TraceparentTargets = string[] | undefined
