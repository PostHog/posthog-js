---
---

chore: remove the unused internal `getFlagDetailsFromFlagsAndPayloads` helper from `@posthog/core`. It had no callers (only its own test) and was not part of the package's public exports, so there is no consumer-facing change.
