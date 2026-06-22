---
'posthog-js': patch
---

Fix `captureConsoleLogs` so console logs auto-link to person profiles in PostHog Logs. The browser console-logs entrypoint was emitting the person identifier under `distinct_id`, while every other logs path in the SDK (`posthog.logger.*` / `captureLog`, React Native, Node, the OTLP record builder in `@posthog/core`) emits `posthogDistinctId` — which is also the backend default for "Link to person". The mismatched key meant the console-logs path never linked out of the box. The browser path now emits `posthogDistinctId` to match the rest of the SDK and the backend.
