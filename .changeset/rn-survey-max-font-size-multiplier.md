---
'posthog-react-native': minor
---

feat(react-native): let surveys cap how far their text scales with the OS text-size setting, per text role — `appearance.maxFontSizeMultiplier` takes one number for the whole survey or an object keyed by role (`question`, `description`, `header`, `choice`, `input`, `button`, `ratingLabel`, `ratingNumber`, `validationHint`). Unset, text scales without a ceiling exactly as before.
