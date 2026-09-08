---
'posthog-js': patch
---

Surveys now report when PostHog is not capturing. `canRenderSurvey` and `displaySurvey` give a reason, the display loop keeps such a survey off screen, and a dropped `survey sent` response is logged. Before this, a person could type an answer, see the confirmation, and lose the answer with no signal.

This also covers a visitor who has not answered a consent banner yet. With `opt_out_capturing_by_default`, PostHog does not capture for that visitor, so a survey no longer appears until the visitor gives consent.
