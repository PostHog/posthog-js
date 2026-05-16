---
'posthog-js': patch
---

Dead clicks: a click on an `<a>` (or any element inside an `<a>`, including across shadow DOM) is no longer flagged as a dead click — the browser navigates / downloads / opens a new window and we can't observe that. Reuses autocapture's existing DOM walker for the ancestor walk. Direct clicks on `<button>`, `<input>`, `<select>`, `<textarea>`, `<label>`, and `<form>` (previously all skipped) are now eligible for dead-click detection: if their JS handler ran, the existing mutation / scroll / selection observers see the effect; if it didn't, dead-click correctly surfaces the bug. A broken `<button>` with no handler, or an `<svg>` icon inside one, will now flag — which is exactly the dead-click case we want to catch.
