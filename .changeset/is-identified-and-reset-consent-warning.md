---
'posthog-js': patch
'@posthog/types': patch
---

fix: warn when `reset()` silently opts the user back out

`reset()` clears stored consent along with the rest of the user's state. With `opt_out_capturing_by_default`, this returns the instance to the opted-out default, so calling `reset()` after `opt_in_capturing()` would stop capturing without warning. It now logs a warning when that happens and documents the required ordering.
