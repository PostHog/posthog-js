---
'posthog-js': patch
---

Session replay no longer records when `blockSelector` or `maskTextSelector` is not a valid selector in the visitor's browser, and logs an error naming it. Before, an invalid `blockSelector` recorded the content it was meant to block in the first snapshot and then broke recording, and an invalid `maskTextSelector` recorded text unmasked.
