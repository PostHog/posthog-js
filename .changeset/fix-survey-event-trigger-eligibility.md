---
'posthog-js': patch
---

Fix `canRenderSurvey` / `canRenderSurveyAsync` reporting a survey as renderable before its event/action activation trigger has fired. Surveys gated on a "User sends events" filter are now only eligible once the trigger event is received.
