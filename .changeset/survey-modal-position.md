---
'posthog-react-native': patch
---

Fix `SurveyModal` ignoring `appearance.position`. The modal previously hard-coded a bottom-center layout regardless of the configured position. It now honors all 9 `SurveyPosition` values, mirroring the web SDK semantics: `top_*` anchors to the top edge, `middle_*` to the vertical middle, and `left` / `center` / `right` (no prefix) to the bottom edge.

Note: the documented default `SurveyPosition.Right` now actually applies. Surveys without an explicit position will move from bottom-center (the previous accidental default) to bottom-right (the documented default). Set `appearance.position` to `SurveyPosition.Center` to restore the old layout.
