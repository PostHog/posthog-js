---
'posthog-js': patch
---

fix(consent): reload feature flags on `opt_in_capturing()` so flag and experiment values match the post-consent identity. Previously the flags evaluated before consent, against an anonymous or cookieless identity, stayed cached for the whole session.
