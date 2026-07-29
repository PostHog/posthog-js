---
'posthog-js': patch
---

Fix hosted (external) surveys with URL prefill: the auto-submitted response now includes caller-provided event properties (extra URL query params), and a later manual submit no longer clears the prefilled answer from the partial-response merge.
