---
'@posthog/ai': patch
'@posthog/mcp': patch
---

Genkit spans and `@posthog/mcp` events with no user distinct id set the `process_person_profile: false` event option on posthog-node 6, so a registered or context `process_person_profile: true` option no longer creates a person for each trace or session. Genkit also counts an empty or whitespace-only distinct id as missing.
