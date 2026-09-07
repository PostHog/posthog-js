---
'posthog-js': patch
---

Surveys now report when capturing is opted out. `canRenderSurvey` and `displaySurvey` give a "capturing is opted out" reason, the display loop keeps such a survey off screen, and a dropped `survey sent` response is logged. Before this, a person could type an answer, see the confirmation, and lose the answer with no signal.
