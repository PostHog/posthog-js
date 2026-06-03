---
'posthog-js': patch
'@posthog/rrweb': patch
---

replay: re-apply scroll positions after fast-forward/seek. Scrolls applied mid-catch-up could clamp to 0 when the target wasn't scrollable yet (e.g. scroll-revealed sheets/modals whose content sits below the fold), leaving the content scrolled out of view on replay. The last scroll per node is now re-applied in the flush stage once layout has settled. `posthog-js` is bumped too so the rebuilt bundle containing the fix is published.
