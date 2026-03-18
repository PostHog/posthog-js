---
'posthog-js': minor
---

Fixed $set_once initial person properties (e.g. $initial_current_url) not being included with $identify calls when they had already been sent with a prior event. This ensures initial properties are reliably set when identifying users across subdomains, even if an anonymous event was captured first.
