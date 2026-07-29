---
'posthog-js': minor
'@posthog/types': minor
---

feat: add `isIdentified()` and warn when `reset()` silently opts the user back out

`posthog.isIdentified()` is now public, so checking whether an identity was restored from persistence — e.g. in the `loaded` callback, before the initial `$pageview` — no longer requires the private `_isIdentified()`.

`reset()` clears the stored consent along with the rest of the user's state. With `opt_out_capturing_by_default` that returns the instance to the opted-out default, so calling `reset()` after `opt_in_capturing()` stopped capturing with no error. It now logs a warning when that happens, and the ordering requirement is documented on `reset()`.
