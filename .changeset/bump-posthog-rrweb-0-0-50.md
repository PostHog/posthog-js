---
'posthog-js': patch
---

Bump @posthog/rrweb packages to 0.0.56, which includes:
- PostHog/posthog-rrweb#157: fix: clear mutation buffer on iframe pagehide to prevent recording corruption
- PostHog/posthog-rrweb#158: fix: skip unchanged setAttribute calls to prevent replay flicker
- PostHog/posthog-rrweb#159: fix: prevent iframe leak in untainted prototype and avoid unnecessary iframe creation
- PostHog/posthog-rrweb#163: fix: handle SecurityError in IframeManager destroy and removeIframeById
- PostHog/posthog-rrweb#166: fix: remove postcss from @posthog/rrweb-record bundle (420KB → 170KB)
