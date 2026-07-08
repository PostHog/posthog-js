// Convex runs in a V8 isolate that may not provide globals that
// @opentelemetry/core expects at module evaluation time. This file
// must be imported before any OTEL module.

// polyfill performance without using node:perf_hooks
if (typeof performance === 'undefined') {
    class MockPerformance {
        timeOrigin = Date.now()
        now() {
            return Date.now() - this.timeOrigin
        }
    }
    globalThis.performance = new MockPerformance() as unknown as typeof performance
}
