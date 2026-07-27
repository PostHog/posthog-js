---
"posthog-react-native": minor
---

Add an `autoPresentSurveys` prop to `PostHogSurveyProvider`. Set it to `false` to defer automatic presentation of popover surveys, for example while a native-stack `formSheet` or `modal` is on top. Deferral is display-only: the survey stays armed and presents once the prop becomes `true` again, and a survey already on screen is never interrupted.
