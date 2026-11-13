---
'posthog-node': major
---

Generated event uuids and personless distinct ids take their random bits from `crypto.getRandomValues` instead of `Math.random`.
