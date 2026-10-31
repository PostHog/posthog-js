---
'posthog-js': patch
---

fix: `opt_in_capturing()` now captures the `$opt_in` event (or the custom `captureEventName`) only when the user was not already opted in. Consent tools often re-apply stored consent on every page load, which sent one billed `$opt_in` event per page. Opting out and back in, or calling `reset()` first, still captures it.
