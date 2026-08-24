---
'posthog-js': minor
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb-utils': patch
---

Preserve approved Schema.org JSON-LD in session replay. The recorder parses each JSON-LD script and creates new JSON from path-specific property rules. It drops invalid scripts, masked scripts, unsupported root types, and all properties that the rules do not include. Replay rebuilds each recorded script as an inert `noscript` element.
