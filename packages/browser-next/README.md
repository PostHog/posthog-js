# @posthog/browser

An experimental PostHog client for modern browsers.

The package root contains the capture host and a bounded in-memory analytics queue. It does not transmit analytics until the first-party delivery extension is installed.

Install Capture Analytics V1 delivery immediately:

```ts
import { createPostHog } from '@posthog/browser'
import { analytics } from '@posthog/browser/analytics'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [analytics()],
})
await posthog.capture('signed_up')
await posthog.flush()
```

Or capture synchronously into the core queue and load delivery later:

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({ projectToken: '<project-token>' })
await posthog.capture('signed_up')

await posthog.loadExtension(async () => {
    const { analytics } = await import('@posthog/browser/analytics')
    return analytics()
})
await posthog.flush()
```

`capture()` resolves after queue admission. Without an attached analytics extension, `flush()` resolves without discarding unexpired queued events. Core admission retains at most 1,000 queued events and 8 MiB of active-plus-queued finalized analytics messages; queued work expires strictly after one hour on the next queue interaction. Queue overflow evicts the oldest queued prefix, while active bytes cannot be recalled and can cause a new event to be rejected.

The analytics extension sends FIFO Capture V1 batches of at most 100 events and partitions large backlogs by exact uncompressed envelope size. When remote configuration advertises gzip, eligible batches use native `CompressionStream`; delivery remains uncompressed while configuration is unresolved or compression is unavailable, invalid, stalled, or larger than the JSON body.

One initial `$pageview` is admitted through the same queue after configured extensions install. Set `capturePageview: false` to disable it. Navigation tracking, URL/title enrichment, and page-leave capture remain optional product behavior.

Consent is stored separately from identity under `__ph_opt_in_out_<project-token>`. Use `consentPersistenceName` to supply a shared key verbatim. The client reads established `1`/`true`/`yes` and `0`/`false`/`no` values, including raw boolean and numeric compatibility values, and writes `1` or `0`. Prior denial is applied before identity, persistence, extensions, or requests initialize.

Session and window IDs are created on the first successfully admitted capture. Rejected work does not create or advance them. Idle timeout, maximum length, and reset rotate both IDs. Same-origin tabs share the active session while retaining distinct window IDs; ordinary reloads preserve the window ID and copied tab storage receives a new one. Session rotation is activity-driven and starts no core timer.

This package is private while the API and capture behavior remain experimental.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
