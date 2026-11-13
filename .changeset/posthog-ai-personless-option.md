---
'@posthog/ai': patch
---

An AI event with no user distinct id now also sets the `process_person_profile: false` event option, so with posthog-node 6 it stays personless even when a context or registered option turns person processing on. An empty or whitespace-only distinct id now counts as missing in every integration, so the event uses the trace or run id and stays personless.
