---
'posthog-js': patch
'@posthog/rrweb-snapshot': patch
---

fix(replay): stop polling preload-as-style `<link>` elements forever. Session recorder treated `<link rel="preload" as="style" href="*.css">` as if it were a stylesheet and waited for `link.sheet` to populate. Per spec preload links never instantiate a `CSSStyleSheet`, so the wait timed out, re-serialized the link, scheduled another wait, and leaked a `load` listener on every cycle — multiplying further on every real `load` event. Pages with Next.js-style CSS preloads accumulated thousands of active polling chains, saturating the main thread and freezing the tab on refocus
