---
'posthog-js': patch
---

Capture `<link rel="stylesheet">` URLs from `link.sheet.href` and try `link.sheet` directly for inlining, so recordings survive SPA `history.pushState` navigations between routes of different path depths (where `link.href` re-resolves against a new baseURI but `link.sheet.href` preserves the URL the browser actually fetched).

Ships the fix landed in #3635, which only bumped the internal `@posthog/rrweb-snapshot` package — that package is bundled into `posthog-js` at build time but is not published to npm on its own, so a `posthog-js` bump is needed to actually deliver the change.
