---
'posthog-node': patch
---

fix: let later conditions resolve a flag locally when an unexpected error follows a filter that local evaluation cannot check, instead of failing the whole flag
