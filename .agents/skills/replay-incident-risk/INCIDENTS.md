# Replay and SDK incident pattern registry

A catalog of past incidents caused by changes to posthog-js and the rrweb fork, organized by the code-level pattern that caused them. Used by the `replay-incident-risk` skill and the `Replay incident risk` CI check to flag diffs that resemble a past incident.

Each entry describes the mechanism, not the blast radius. Internal impact numbers, customer names, and postmortem contents are deliberately omitted; PostHog employees can find the detail through the linked incident channels and the internal post-mortems repo.

---

## Class 1: Version skew across the lazy-load boundary

**The single most repeated cause.** The recorder, surveys, web-vitals, and tracing-headers extensions are lazy-loaded from the CDN. With `strict_script_versioning: false`, the `?v=` query param is only a cache-buster: the CDN serves the **latest published bundle to every SDK version, including npm-pinned ones** (`external-scripts-loader.ts`). The default `'fallback'` mode loads the exact SDK version first but can still use this legacy path if the versioned asset is unavailable. Publishing an extension change remains a fleet-wide deploy with no rollout control for SDKs that use the legacy path.

The canonical failure: new extension code assumes something only newer cores provide (a function, a config field, a persisted value), or changes a cross-boundary function signature. Old cores load the new bundle and break.

Known incidents in this class:

- **Recorder rejected persisted config from old cores (Mar 2026, INC-749).** The new recorder added a staleness check on persisted remote config keyed on a `cache_timestamp` field old cores never wrote. `timestamp ?? 0` made every saved config infinitely stale, so the recorder deleted it and never started. Only reproduced when the recorder started from persisted config before the live config fetch returned, a race that instant-mock CI never hit. Millions of recordings were lost over a weekend, unrecoverably. Reverted in [#3213](https://github.com/PostHog/posthog-js/pull/3213) (v1.360.0); introduced by [#3191](https://github.com/PostHog/posthog-js/pull/3191).
- **Surveys stopped rendering for all older cores (Jul 2025).** A change added a second argument to `generateSurveys()`; old cores loading the new unversioned `surveys.js` passed `undefined`, treated as `false`. Fixed in [#2074](https://github.com/PostHog/posthog-js/pull/2074) by treating `undefined` as the old behavior.
- **Surveys code called a function old cores don't install (Oct 2025).** Produced identical exceptions captured at very high volume in customer apps, inflating their error-tracking usage. Reverted, patched in v1.270.1 ([#2355](https://github.com/PostHog/posthog-js/pull/2355) was the trigger). Public postmortem: [post-mortems repo](https://github.com/PostHog/post-mortems).
- **Web vitals capture broke for six days (Jan 2026, INC-695).** A non-backward-compatible release broke `$web_vitals` capture fleet-wide; no per-event-type volume alerting existed, so it ran for six days. Fixed in [#2973](https://github.com/PostHog/posthog-js/pull/2973).

**Review questions for any diff touching `entrypoints/` bundles or `extensions/`:**

1. Does this change a function signature, argument list, or return shape that is called across the core/extension boundary?
2. Does new extension code call anything that might not exist in a core released a year ago?
3. Does new code read persisted state (localStorage, cookies, persistence keys) that old cores wrote in a different shape? Absent fields must be treated as neutral, never as fatal or stale.
4. Does the compat test suite (old core + new lazy bundles, added in [#3003](https://github.com/PostHog/posthog-js/pull/3003)) cover this path, including a cold start from persisted config with a slow remote-config response?

## Class 2: Session rotation, idle handling, and flush semantics

Changing when sessions rotate, how idle state is tracked, or when buffers flush directly changes **how many recordings ship**, and every shipped recording bills. There is a long history of session-rotation changes being painful in exactly this way.

- **Idle-tab over-recording (Jul-Aug 2026, INC-975).** [#4224](https://github.com/PostHog/posthog-js/pull/4224) flipped the "unknown" idle state to "not idle" to fix a playability bug. Side effect: every activity-timeout rotation in a parked background tab shipped a billed Meta+FullSnapshot recording, an unbounded chain per idle tab. Fleet-wide zero-interaction recordings surged for 11 days before a customer bill complaint surfaced it. It also produced multi-day-long recordings from idle buffers flushed late. Fixed by [#4407](https://github.com/PostHog/posthog-js/pull/4407) (hold rotation-born sessions in a buffer until real user interaction, cap recording age), plus [#4410](https://github.com/PostHog/posthog-js/pull/4410) and [#4412](https://github.com/PostHog/posthog-js/pull/4412).

**Review questions:**

1. Walk through an idle background tab over 24+ hours: how many recordings does this change cause to ship? Each rotation that ships a snapshot is a billed recording.
2. Do URL triggers (which match `window.location.href` without any user interaction) or `recordCrossOriginIframes` amplify the change?
3. What is the oldest event a flushed buffer can contain after this change?
4. If recording volume moves fleet-wide, the week-over-week recordings anomaly alert should catch it within a day. Watch it after release.

**Volume invariants.** These must hold after any change in this class. The scenario tests in `lazy-sessionrecording.test.ts` (`recording volume invariants` block) assert them over multi-day simulated timelines; if your change could affect one, extend that block rather than only testing your mechanism:

- A tab with zero user interaction ships zero recordings while it stays open, no matter how many rotations pass.
- A session with one interaction ships exactly one recording; idle rotations after it add none.
- No flushed buffer contains events older than the session age cap.

## Class 3: Network primitive wrappers (fetch and XHR patching)

The highest-severity class: bugs here **break the customer's own site**, not just telemetry, and spread instantly to all SDK versions via the unversioned recorder bundle. Three separate incidents have come from the fetch wrappers. Standing policy from those incidents: no AI-generated PRs in the wrappers, and every change lands with a failing real-browser test first.

- **FormData bodies broken (Jan 2026).** A fetch-wrapper "improvement" broke processing of `FormData` request bodies; customer sites failed to submit POST requests (checkouts, file uploads, logins) until the change was rolled back. Most customers were unaffected, which made it slow to detect; it was found through customer reports, not monitoring. Public postmortem: [replay SDK fetch wrapper incident](https://github.com/PostHog/post-mortems/blob/main/2026-01-17-replay-sdk-fetch-wrapper-incident.md). Follow-up compat tests: [#2935](https://github.com/PostHog/posthog-js/pull/2935).
- **Safari string-body POSTs threw NotSupportedError (May 2026).** Both wrappers rebuilt `fetch(url, init)` as `new Request(url, init)`. Per the Fetch spec a string body becomes a `ReadableStream`; when a downstream fetch wrapper forwarded `request.body`, Safari (which doesn't support ReadableStream upload) threw on every POST with a string body. Fixed in [#3706](https://github.com/PostHog/posthog-js/pull/3706) (v1.378.1) with a WebKit Playwright regression test simulating an inner wrapper. Related hardening in [#3711](https://github.com/PostHog/posthog-js/pull/3711): spreading a `RequestInit` drops non-enumerable and accessor-backed fields (`body`, `signal`, `duplex`), because it is a WebIDL dictionary, not a plain object.
- An earlier fetch-wrapper regression predates both of these.

**Review questions:**

1. Does the change preserve every body type: string, `FormData`, `Blob`, `ArrayBuffer`, `URLSearchParams`, `ReadableStream`?
2. Is there a real-browser (including WebKit) test that exercises the change with **another fetch wrapper on the page** forwarding the Request? Many customer sites wrap fetch too.
3. Never rebuild the caller's arguments into a `Request` you then hand downstream unless the caller passed a `Request`.
4. Never spread `RequestInit` or `Request` into a plain object.

## Class 4: rrweb serialization and snapshot correctness

Serializer bugs corrupt replay **silently**: no exception, no volume change, just wrong or missing content discovered later by whoever watches the recording.

- **CSS custom-properties emptied layout styles (May 2026).** Per the CSS spec, a shorthand set to `var()` with one longhand overridden by another `var()` stores the shorthand's longhands as empty token lists. rrweb serialized styles via `cssText`, emitting empty declarations (`padding-top: ;`), so layout silently vanished for sites using Chakra v3 / Panda CSS patterns. Fixed in [#3542](https://github.com/PostHog/posthog-js/pull/3542) (v1.372.10), tracked upstream as [rrweb#1667](https://github.com/rrweb-io/rrweb/issues/1667). Known remaining gap: stylesheets built via `insertRule()` before the first full snapshot (Emotion "speedy" mode).

**Review questions:**

1. If this touches style serialization (`cssText`, `adoptedStyleSheets`, stylesheet mirroring), test against framework-generated CSS: Chakra/Panda, Emotion (speedy mode), Tailwind, CSS custom properties, shorthand/longhand mixes.
2. Failures here have no error signal. What would make this bug visible if it shipped? Add a real-browser snapshot assertion, not a unit test on mocked DOM.

## Class 5: Replay reconstruction and player security

Recorded page content is **untrusted input**. rrweb's replay sandbox (script-disabled iframe) protects rebuilt page DOM, but anything the replayer or plugins place in the top-level document sits outside it and must be sanitized independently.

- **Canvas replay copied `onerror` onto a live img (Jul 2026).** The canvas plugin reconstructed recorded canvases as `<img>` elements in the top-level replay document and copied every recorded attribute across, including inline event handlers. A crafted `onerror` attribute plus a failing image source meant stored XSS in the viewer's dashboard session. Fixed in [posthog#68918](https://github.com/PostHog/posthog/pull/68918) by skipping `on*`, `src`, and `srcset`. Related guard: a test forbids rrweb's `UNSAFE_replayCanvas` option, which would add `allow-scripts` to the sandbox iframe.

**Review questions:**

1. Does replay-side code copy recorded attributes, HTML, or URLs into the live document? Allowlist what you copy; never copy `on*` handlers, `src`/`srcset`/`href` you don't construct yourself, or `style` containing `url()` you haven't checked.
2. Does anything weaken the iframe sandbox (`allow-scripts`, `UNSAFE_replayCanvas`)?

## Class 6: Recording start conditions and remote config semantics

Changes to when recording is allowed to start (trigger evaluation, authorized domains, sampling, remote config fetch) fail silently in the suppress direction: recordings just stop, and nobody gets an error.

- **New /flags endpoint disagreed with /decide on authorized domains (Jun 2025, INC-422).** A behavioral mismatch between the two implementations meant the newest posthog-js received a recording-disabled config for teams that had never set authorized domains. Recording silently stopped for days for those on the new endpoint.
- **Remote config depended on a query param customer proxies dropped (Aug 2025, INC-489).** The /decide-to-/flags migration made recording config conditional on `?config=true`; customer reverse proxies that forward only the path dropped it, so the SDK never received recording config. Fixed server-side by returning a sensible default response.
- Note the legacy authorized-domains check matches `Origin`/`Referer` headers server-side, not the page URL, so same-origin proxies and strict referrer policies silently disable it. It is deprecated for this reason.

**Review questions:**

1. When a trigger/config check cannot be evaluated (missing field, unreachable endpoint, stripped header or query param), does recording fail open or closed, and is that deliberate?
2. Will this behave behind a customer reverse proxy that strips query strings, headers, or referrers?
3. Endpoint or protocol migrations: does the old response shape and the new one both start recording correctly on old and new cores?

## Class 7: Release and delivery channel integrity

Bugs and attacks in how the SDK reaches browsers, rather than in SDK logic.

- **Managed reverse proxy CORS misconfiguration (May 2026, INC-874).** A Cloudflare worker change to `/static/` routing served `array.js` without `Access-Control-Allow-Origin`, so browsers silently refused to load the SDK for all managed-proxy customers for several hours: no events, recordings, or client-side flags.
- **npm supply-chain compromise (Nov 2025, INC-612).** An attacker exploited a `pull_request_target` workflow that checked out PR-author code, stole a bot PAT, exfiltrated the org npm token, and published trojanized versions of several packages including posthog-js and `@posthog/rrweb*`. Detected by a human noticing a publish with no matching commits. Countermeasures now standing: npm Trusted Publishing (OIDC), pnpm with lifecycle scripts disabled and a minimum release age, no `pull_request_target`, per-repo secrets, release-to-CI correlation monitoring. Public postmortem: [Nov 24 attack post-mortem](https://posthog.com/blog/nov-24-shai-hulud-attack-post-mortem).

**Review questions:**

1. Workflow changes: never reintroduce `pull_request_target` with a checkout of PR code; keep `.github` under CODEOWNERS; don't add lifecycle scripts (`preinstall`/`postinstall`) to any package.
2. Anything touching how bundles are served (CDN paths, CORS, cache headers) is a fleet-wide single point of failure; verify cross-origin loading from a real page, not curl.

---

## Class 8: Masking, privacy, and consent (proactive, no incident yet)

No registry incident here yet, and that is the point: a regression in input masking, text masking, canvas masking, or consent/opt-out handling **records data the customer promised their users we would not store**. Nothing throws, recording volume doesn't move, and no alert exists that could fire. Discovery would come from a customer finding a password in a replay, and the recorded data cannot be un-stored.

**Review questions:**

1. Does the change touch masking defaults, selector matching, or the order in which masking is applied vs when the snapshot is serialized? Any path where a node is serialized before masking runs is a leak.
2. Could a new element type, attribute, or mutation path bypass `maskAllInputs` / `maskTextSelector` / canvas masking? Password inputs must be masked in every code path, including mutations and attribute changes, not just the initial snapshot.
3. Does the change affect opt-out, consent state, or `disable_session_recording` being respected before the first event is captured (not just before the first flush)?
4. Add a real-browser test asserting the sensitive value does not appear anywhere in the emitted snapshot bytes.

## Class 9: Capture transport and retry behavior (proactive, no incident yet)

The rate limiter, retry queue, and request queue run on every customer page. A retry bug here scales by the size of the fleet: retries without backoff or jitter become a coordinated flood against capture during any ingestion blip, and over-eager deduplication or dropped queues become silent event loss.

**Review questions:**

1. On a 5xx or network failure, does every retry path keep exponential backoff and jitter, with a bounded retry count?
2. Can the same event be sent twice (retry after a timeout that actually succeeded), and is that acceptable downstream?
3. When the rate limiter engages, what is dropped, and is the drop observable (`$rate_limit` style signal) rather than silent?
4. Walk a page that stays open through a 30-minute capture outage: how many requests does this change cause it to send during and after?

---

## Cross-cutting lessons

- **npm pinning does not protect customers.** Until extension scripts are strictly versioned everywhere, treat every publish of a lazy-loaded bundle as an immediate fleet-wide deploy to all SDK versions ever released.
- **Detection lag is the norm, not the exception.** These incidents were found by customers, bills, and support tickets days later, not by alerts. If a change could move recording volume, event volume, or error volume, decide before merging how you would notice within a day.
- **Both directions bill.** Over-recording inflates PostHog bills; exception floods inflate customers' error-tracking usage; suppression destroys unrecoverable data. There is no cheap direction to be wrong in.
- **Test with old cores and real browsers.** The compat suite exists because mocked-instant, latest-only CI missed the two biggest recorder incidents. New cross-boundary behavior needs a test against a genuinely old pinned core and real network latency.
