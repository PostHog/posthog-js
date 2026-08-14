---
'posthog-react-native': patch
---

Avoid re-reading the feature flag store when feature flag hooks rerender with unchanged inputs.
