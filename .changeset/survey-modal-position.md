---
'posthog-react-native': patch
---

Fix `SurveyModal` ignoring `appearance.position`. The modal previously hard-coded a bottom-center layout regardless of the configured position. It now honors all 9 `SurveyPosition` values, mirroring the web SDK semantics: `top_*` anchors to the top edge, `middle_*` to the vertical middle, and `left` / `center` / `right` (no prefix) to the bottom edge. The default remains bottom `center`.
