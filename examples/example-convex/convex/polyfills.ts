// Convex runs in a V8 isolate that may not provide the `performance` global.
// OpenTelemetry's @opentelemetry/core browser platform entry expects it at
// module evaluation time, so this polyfill must be imported before any OTEL
// module.
if (typeof performance === 'undefined') {
    ;(globalThis as any).performance = { now: () => Date.now(), timeOrigin: Date.now() }
}
