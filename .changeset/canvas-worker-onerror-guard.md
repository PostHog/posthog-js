---
"@posthog/rrweb": patch
---

Session replay: guard the canvas recording inline worker against blob-script load failures. When a strict page CSP (worker-src / script-src blob:), an ad blocker, or a network hiccup prevents the inline worker from loading, canvas snapshotting now disables itself quietly instead of surfacing an uncaught NetworkError. The rest of session replay keeps working.
