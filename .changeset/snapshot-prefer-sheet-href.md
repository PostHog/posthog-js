---
'@posthog/rrweb-snapshot': patch
---

Capture `<link rel="stylesheet">` URLs from `link.sheet.href` and try `link.sheet` directly for inlining, so recordings survive SPA `history.pushState` navigations between routes of different path depths (where `link.href` re-resolves against a new baseURI but `link.sheet.href` preserves the URL the browser actually fetched).
