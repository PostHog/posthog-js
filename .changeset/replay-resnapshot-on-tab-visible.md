---
'posthog-js': patch
---

fix(replay): re-sync DOM and scroll state when a backgrounded tab becomes visible again. A hidden tab keeps running MutationObserver, so streamed DOM (for example an AI chat response) is still captured while the app skips its auto-scroll-to-bottom on a hidden tab. Because scroll is only captured as a discrete incremental event, none is emitted, so on return the recording shows content below the fold. The recorder now takes a full snapshot immediately on the hidden-to-visible transition and restarts the normal snapshot cadence.
