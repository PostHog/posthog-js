---
'posthog-js': minor
---

Preserve approved Schema.org `Product` JSON-LD in session replay. The recorder parses each JSON-LD script and creates new JSON from type-specific property rules. It drops invalid scripts, unsupported root types, and all properties that the rules do not include. Replay still rebuilds each recorded script as an inert `noscript` element.
