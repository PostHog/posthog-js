---
'posthog-js': patch
'@posthog/types': patch
---

fix(replay): preserve privacy masking for initial network metadata

Initial navigation and performance-timing entries are now passed through `maskCapturedNetworkRequestFn`, including when they have no method. URL rewrites are respected. When the callback returns nullish for an initial entry, replay-required timing metadata is retained without its URL, headers, or body so method-gated callbacks do not drop the metadata or expose deliberately filtered customer data. Derived server-timing entries are also suppressed when this strict fallback is used. Enforced PostHog filtering and payload cleaning still run first.
