---
'@posthog/types': patch
---

Document the session replay input masking defaults in the `session_recording` config reference: inputs are masked by default, password inputs stay masked on a partial `maskInputOptions` override, non-input text and images need `maskTextSelector`, and client-side masking options override the project privacy setting.
