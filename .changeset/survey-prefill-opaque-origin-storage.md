---
'posthog-js': patch
---

fix(surveys): keep URL prefill working when localStorage is unavailable

The in-progress survey state is the only channel that carries a URL-prefilled answer, and the question index it advances to, from `renderSurvey` to the question renderer. Where `localStorage` refuses the write — a document with an opaque origin (a `sandbox` CSP without `allow-same-origin`), private mode, blocked storage, or quota reached — the state was lost, so an auto-submit question that a `q<n>` URL parameter had already answered was shown again. The surveys extension now keeps what storage refused in memory for the page load and prefers it on read, leaving behaviour unchanged wherever storage works. `posthog.reset()` drops it, so in-progress answers do not outlive a logout.
