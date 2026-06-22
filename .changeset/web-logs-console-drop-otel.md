---
'posthog-js': minor
'@posthog/core': patch
---

Console log auto-capture (`logs: { captureConsoleLogs: true }`) now flows through the same pipeline as `posthog.captureLog()`, `posthog.logger.*`, and PostHog's other SDKs, instead of OpenTelemetry. As a result:

- the bundled OpenTelemetry dependencies are removed, shrinking the lazily-loaded logs chunk
- auto-captured console logs now run through `logs.beforeSend` (the same hook as `captureLog`/`logger.*`), so you can redact or drop sensitive console output before it's sent. To treat console logs differently from manual logs, branch on the record's `log.source` attribute: auto-captured console logs set it to `console.<method>` (e.g. `console.error`), while manual `captureLog`/`logger.*` logs leave it unset
- console logs now link to the person's profile: they carry the person id as `posthogDistinctId`, the attribute PostHog uses to associate logs with a person ([docs](https://posthog.com/docs/logs/link-person)). The old path used `distinct_id`, which isn't used for person linking by default, so console logs previously didn't appear on person profiles unless you'd configured a custom key.

Console logs keep their `posthog-browser-logs` `service.name`, their `console` instrumentation scope, and their `log.source: console.<level>` attribute.

As part of moving onto the shared pipeline, console records now use PostHog's standard log field names — the same ones programmatic web logs and other SDKs use, and the ones the Logs UI surfaces. For the fields below the **values are unchanged** — only the attribute names/locations differ:

- `distinct_id` → `posthogDistinctId` (record attribute)
- `location.href` → `url.full` (record attribute; same value — the page URL)
- `session.id` (resource attribute) → `sessionId` (record attribute) — renamed and moved
- `host` and `window.id` move from resource attributes to record attributes (names unchanged)
- records also now carry the standard SDK context shared by other logs, including `feature_flags`

For most projects this needs no action — these are already the canonical log fields. The only thing to update is a saved Logs query or dashboard built specifically on an **old** console attribute name, for example:

- `attributes.distinct_id` → `attributes.posthogDistinctId`
- `attributes.location.href` → `attributes.url.full`
- `resource.attributes.session.id` → `attributes.sessionId`
- `resource.attributes.host` / `resource.attributes.window.id` → `attributes.host` / `attributes.window.id`
