# Session replay network privacy controls

For the browser SDK, filtering captured network output and preventing network-detail reads are different policies. Request/response bodies and headers are off by default unless enabled by remote project settings. The examples below use existing `session_recording` options in `posthog.init`.

## Filter captured output by URL

When network capture is enabled, use `maskCapturedNetworkRequestFn` to retain only explicitly allowed URLs:

```ts
import posthog from 'posthog-js'

posthog.init('<ph_project_token>', {
    session_recording: {
        maskCapturedNetworkRequestFn: (request) =>
            request.name === 'https://api.example.test/public/status' ? request : null,
    },
})
```

This exact-match positive allowlist excludes other paths, hosts, and query strings. Replace the synthetic URL with one whose captured content you intend to retain. The hook does not itself enable body or header capture.

The hook receives already-captured data. Returning `null` or `undefined` drops an ordinary request from the network plugin's output, **after collection**. When body/header capture is enabled, excluded fetch and XHR requests may already have had their bodies read and headers collected. Deleting body or header fields in the hook also only changes output; it cannot undo those reads. This is not a selective pre-read URL allowlist.

Initial navigation/performance entries (`isInitial === true`) are an exception to dropping the entire entry: replay-required timing metadata remains, without the URL, headers, or body. The hook also participates in replay page-URL masking, so review the [URL redaction guidance](https://posthog.com/docs/session-replay/privacy#url-redaction) when applying an allowlist.

A custom hook replaces automatic payload redaction, although mandatory header cleaning still applies. The example returns allowed content unchanged; redact any sensitive allowed payloads yourself. See [network recording and redaction](https://posthog.com/docs/session-replay/network-recording).

## Prevent network-detail reads globally

If your policy requires the replay network plugin not to access request/response bodies or headers, explicitly disable **both** controls at initialization:

```ts
import posthog from 'posthog-js'

posthog.init('<ph_project_token>', {
    session_recording: {
        recordBody: false,
        recordHeaders: false,
    },
})
```

Both public options are booleans. Explicit local `false` takes precedence over remote enablement for each option. With both off, the replay network plugin does not install its fetch/XHR detail-capture wrappers. This applies to every URL; it cannot retain details for selected allowed URLs.

Do not rely on `recordBody: false` alone for strict non-access: when headers remain enabled, instrumentation can still inspect headers and access request-body properties. Likewise, `recordHeaders: false` alone does not prevent header inspection needed during body capture.

These settings only disable replay network body/header collection. They do not disable network timing/URL recording, DOM snapshots, other SDK collection, or all transmission to PostHog. Configure [replay privacy controls](https://posthog.com/docs/session-replay/privacy) and consent separately for those requirements.
