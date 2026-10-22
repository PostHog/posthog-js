# Otel

OpenTelemetry support in @posthog/ai: a span processor that turns AI SDK spans into PostHog AI events.

## invariants

- With a `client` option, `PostHogSpanProcessor` snapshots the active PostHog context in `onStart` and merges it into a copy of the span in `onEnd`; the live span and other processors never see it.
- A span's own attributes win over context properties, which win over the context's distinct ID and session ID (exported as `$session_id`). The context's distinct ID is skipped when the span already names a user.
