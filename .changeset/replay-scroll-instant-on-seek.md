---
'posthog-js': patch
'@posthog/rrweb': patch
---

replay: jump scrolls instantly when seeking past pages that use `scroll-behavior: smooth`. During fast-forward the replayer applied scrolls with `behavior: 'auto'`, which inherits the page's CSS `scroll-behavior` — so on sites that set `scroll-behavior: smooth` (e.g. Silk bottom sheets/modals) a seeked scroll animated from 0 instead of jumping, leaving scroll-revealed content (the open sheet) out of view and showing only the backdrop until the animation caught up. Sync scrolls now use `behavior: 'instant'`, matching the method's stated intent that smooth scrolling be disabled while fast-forwarding. Full snapshot rebuilds apply their initial offset with `behavior: 'instant'` too, so the document-level scroll doesn't animate either.
