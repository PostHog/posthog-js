---
'posthog-js': patch
---

chore: update @posthog/rrweb-* to 0.0.55

Changes from [0.0.53 to 0.0.55](https://github.com/PostHog/posthog-rrweb/compare/0.0.53...0.0.55):

- fix: prevent iframe leak in untainted prototype and avoid unnecessary iframe creation ([#159](https://github.com/PostHog/posthog-rrweb/pull/159))
- fix: skip unchanged setAttribute calls to prevent replay flicker ([#158](https://github.com/PostHog/posthog-rrweb/pull/158))
- fix: clear mutation buffer on iframe pagehide to prevent recording corruption ([#157](https://github.com/PostHog/posthog-rrweb/pull/157))
- fix: handle SecurityError in IframeManager destroy and removeIframeById ([#163](https://github.com/PostHog/posthog-rrweb/pull/163))
