---
'posthog-js': patch
---

Session replay network capture: expand the default payload host deny list to skip third-party analytics, RUM, and session-replay telemetry whose payloads have no replay value - Datadog, Segment, RudderStack, Amplitude, Mixpanel, Hotjar (both `.com` and `.io`), and FullStory. Also covers both Google Analytics beacon hosts (`google-analytics.com`, plus `analytics.google.com` which gtag uses when Google Signals is enabled) and widens New Relic to `nr-data.net`.
