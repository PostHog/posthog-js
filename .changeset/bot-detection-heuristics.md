---
"posthog-js": minor
"@posthog/core": minor
---

Opt-in WebView bot heuristic for #2921.

- `posthog-js/customizations` exports a new `isLikelyWebViewBot(ua)` helper that flags the UA pattern described in #2921 (a `Chrome/...` token without the usual `AppleWebKit/*` + `Safari/*` co-markers that real Chrome always sends). Wire it into `before_send` to tag or drop the matching events — see `isLikelyWebViewBot` JSDoc for a usage example. Default SDK behaviour is unchanged; the helper is tree-shaken out unless you import it.
- `@posthog/core` keeps `isBlockedUA` and `DEFAULT_BLOCKED_UA_STRS` byte-for-byte compatible, and gains session-level memoisation of `isBlockedUA` results keyed on `(ua, customBlockedUserAgents)`, so repeat calls within the same session are O(1).
