# PostHog snippet reference

`snippet.js` is a readable reference copy of the PostHog snippet. The
production snippet lives in the posthog/posthog repo; this copy exists so the
snippet's behavior can be tested in this repo against the exact code that
ships.

## `unload-fallback.js` — opt-in unload delivery for queued events

On slow connections the snippet queues `posthog.capture(...)` calls in memory
while `array.js` downloads. If the visitor leaves before it arrives, those
events are lost. This opt-in block recovers them: on page unload, any queued
capture calls are sent with `navigator.sendBeacon` and removed from the queue,
so a late-arriving `array.js` can never send them twice.

It is deliberately **not** part of the standard snippet: it adds ~1.3 KB
gzipped to every page's HTML, and it trades away some correctness guarantees
(see caveats) that only make sense for sites that are actually losing
meaningful data to bounces. Share it with customers who have that problem.

### Installation

Paste the contents of `unload-fallback.js` (or its minified form) in a
`<script>` tag near the PostHog snippet. Order does not matter — it reads
everything at unload time. Pasting it twice is harmless.

To produce the minified form:

```bash
npx terser snippet/unload-fallback.js -c passes=2 -m --ecma 5
```

### What it sends

Events sent this way carry:

- `$sent_by_snippet_fallback_on_unload: true` — filter on this to measure
  recovery volume and to exclude these events from analyses they don't suit
- `$lib: 'web-snippet'` and `$current_url`
- no client timestamp — events are stamped at ingestion, so their time is off
  by the queue-to-unload gap (typically seconds)

### What it will never do

Nothing is sent when:

- the visitor is opted out: stored consent, a queued `opt_out_capturing()`
  call, `opt_out_capturing_by_default` with no opt-in, DNT with
  `respect_dnt`, or any `cookieless_mode`
- the traffic looks automated (`navigator.webdriver` or a bot user agent) —
  the SDK's own bot filtering never ran, so this approximates it, and like
  the SDK it is disabled by `opt_out_useragent_filter: true`
- the site customizes the event pipeline (`before_send`,
  `sanitize_properties`, `property_blacklist`/`property_denylist`,
  `request_headers`, or a queued `set_config`) — bypassing redaction would be
  worse than losing the events
- `disable_beacon` is set, `sendBeacon` is unavailable, or the encoded
  payload would exceed the 64 KB beacon limit (at most 50 events are sent)

It never writes cookies or storage, never logs, and every code path is
wrapped so it cannot throw into page code.

### Caveats to set expectations with

- **Identity**: with no stored identity and no queued `identify`, events are
  sent with a generated personless `distinct_id` (prefixed `snippet-`). They
  count in event analytics but never create person profiles and will not
  join a person identified later in the session. A queued `identify` or an
  existing PostHog cookie/localStorage identity is used when present.
- **At-most-once delivery**: events are removed from the queue only when the
  browser accepts the beacon. Acceptance means queued, not delivered — a
  beacon dropped by the network after acceptance is lost. That is the same
  trust model as the SDK's own unload flush.
- Only `capture` calls are recovered. Everything else (`identify`,
  `register`, feature-flag calls, ...) stays queued for `array.js` in case
  the page returns from the back/forward cache.

### Verifying an installation

1. Open the site with devtools, network throttled so `array.js` stays
   pending.
2. In the console, queue an event: `posthog.capture('fallback-check')`.
3. Navigate away. The network log shows a `POST` to `/e/?compression=base64`.
4. The event appears in PostHog with
   `$sent_by_snippet_fallback_on_unload: true`.
