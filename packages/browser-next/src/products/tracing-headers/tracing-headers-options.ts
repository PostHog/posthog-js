export interface TracingHeadersOptions {
    /**
     * Hostnames whose requests receive `X-POSTHOG-SESSION-ID`, `X-POSTHOG-WINDOW-ID` and `X-POSTHOG-DISTINCT-ID`,
     * so backend events can be linked to the frontend session. Matched exactly against the request hostname,
     * ignoring case; schemes, ports, paths and wildcards are not supported.
     */
    hostnames?: readonly string[]
    /**
     * Hosts that receive a new W3C Trace Context `traceparent` header on each request, so the backend can
     * continue the trace. An entry with a scheme (`https://api.example.com`) matches that origin only; any
     * other entry (`api.example.com`) matches that hostname on any scheme or port. A `traceparent` already
     * set on the request is never replaced. Cross-origin hosts must allow the header in CORS preflights.
     */
    tracePropagationTargets?: readonly string[]
}

const normalize = (values: readonly string[] | undefined, lowerCase: boolean): string[] =>
    Array.isArray(values)
        ? values
              .filter((value): value is string => typeof value === 'string')
              .map((value) => (lowerCase ? value.trim().toLowerCase() : value.trim()))
              .filter(Boolean)
        : []

interface TracingHeadersSnapshot {
    readonly hostnames: string[]
    readonly tracePropagationTargets: string[]
}

/** Snapshot and normalize configuration. Returns `undefined` when no request would be changed. */
export const snapshotTracingHeadersOptions = (
    options: TracingHeadersOptions | undefined
): TracingHeadersSnapshot | undefined => {
    const hostnames = normalize(options?.hostnames, true)
    const tracePropagationTargets = normalize(options?.tracePropagationTargets, false)
    return hostnames.length || tracePropagationTargets.length ? { hostnames, tracePropagationTargets } : undefined
}
