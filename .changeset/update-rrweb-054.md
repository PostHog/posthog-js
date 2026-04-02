---
'posthog-js': patch
---

chore: update @posthog/rrweb-* to 0.0.54

Changes from [0.0.53 to 0.0.54](https://github.com/PostHog/posthog-rrweb/compare/0.0.53...0.0.54):

- fix: prevent iframe leak in untainted prototype and avoid unnecessary iframe creation (#159)
- fix: skip unchanged setAttribute calls to prevent replay flicker (#158)
- fix: clear mutation buffer on iframe pagehide to prevent recording corruption (#157)
- fix: remove postcss from rrweb-record bundle (#164)
- fix: handle SecurityError in IframeManager destroy and removeIframeById (#163)
