---
'posthog-js': patch
'@posthog/rrweb': patch
'@posthog/rrweb-utils': patch
---

record: fix MutationObserver recording on Safari when frameworks monkey-patch built-ins. Keep the untainted-prototype iframe attached on Safari and remove it on recorder teardown. Ported from upstream rrweb 2.0.1 (rrweb-io/rrweb#1854).
