---
'posthog-js': patch
---

Fix `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` thrown from `copiedTextHandler` when `capture_copied_text` is enabled and a user copies/cuts text from a Web Component or other Shadow / DocumentFragment context. Guards parent-walking against non-Element nodes (notably plain DocumentFragments whose `.host` is undefined), uses the null-safe `isTag` helper for tag-name checks, and wraps the copy/cut listener in the same try/catch as the click/change/submit listener so future surprises are logged rather than thrown into the host page.
