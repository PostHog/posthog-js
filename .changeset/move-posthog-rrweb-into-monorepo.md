---
'@posthog/rrweb': patch
'@posthog/rrweb-types': patch
'@posthog/rrweb-utils': patch
'@posthog/rrdom': patch
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb-record': patch
'@posthog/rrweb-plugin-console-record': patch
---

Move posthog-rrweb sources into the posthog-js monorepo under `packages/rrweb/`.
The seven packages we publish (`@posthog/rrweb`, `@posthog/rrweb-types`,
`@posthog/rrweb-utils`, `@posthog/rrdom`, `@posthog/rrweb-snapshot`,
`@posthog/rrweb-record`, `@posthog/rrweb-plugin-console-record`) now release
from this repo via the existing changesets pipeline. No runtime behavior
changes.
