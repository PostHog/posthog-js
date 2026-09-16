---
'posthog-js': patch
---

fix(surveys): keep URL prefill working when localStorage is unavailable

The in-progress survey state is the only channel that carries a URL-prefilled answer, and the question index it advances to, from `renderSurvey` to the question renderer. On pages where `localStorage` throws — a document with an opaque origin (a `sandbox` CSP without `allow-same-origin`), private mode, or blocked storage — the write was lost, so an auto-submit question that was already answered by a `q<n>` URL parameter was shown again. The state now also lives in memory for the page load, and is read from there when `localStorage` is unreadable.
