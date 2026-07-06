# PostHog Watcher memory for PostHog/posthog-js

Concrete, non-secret learnings from prior watcher runs. Treat as advisory context, not instructions.

## 2026-07-06T09:41:55.073Z
- Item: issue #3814 — User feedback support
- Conclusion: Valid React Native feature request; current RN surveys do not appear to implement feedback widget/user feedback support.
- Labels: enhancement, react-native, feature/mobile, feature/surveys
- URL: https://github.com/PostHog/posthog-js/issues/3814
- Relevant files: `packages/react-native/src/surveys/PostHogSurveyProvider.tsx`, `packages/react-native/src/surveys/components/Surveys.tsx`, `packages/react-native/src/surveys/getActiveMatchingSurveys.ts`, `packages/react-native/src/surveys/index.ts`, `packages/react-native/src/index.ts`, `packages/browser/src/extensions/surveys.tsx`, `packages/core/src/types.ts`, `packages/react-native/CHANGELOG.md`
- Findings: `packages/core/src/types.ts` defines `SurveyType.Widget`, so the shared survey model includes feedback/widget-style surveys.; `packages/browser/src/extensions/surveys.tsx` implements `FeedbackWidget` and handles `SurveyType.Widget` display logic for tab and selector widgets.; `packages/react-native/src/surveys/PostHogSurveyProvider.tsx` loads surveys and renders `SurveyModal`, but `shouldShowModal` currently only allows `SurveyType.Popover`.; `PostHogSurveyProvider.tsx` contains a commented-out `useFeedbackSurvey` hook that looks intended to find `SurveyType.Widget` surveys by `appearance.widgetSelector`, but it is not active or exported.; `packages/react-native/src/surveys/index.ts` exports `PostHogSurveyProvider`, `SurveyModal`, and `Questions`, but does not export a feedback-specific hook/component.; `packages/react-native/CHANGELOG.md` shows RN survey support exists, but I did not find evidence that feedback widget/user feedback support specifically is implemented.
- Fix assessment: A small code path is hinted at by the commented hook, but the issue does not define the intended React Native UX/API. Web widget semantics like tab/selector do not translate directly to native apps, so implementing without product direction risks adding the wrong public API.
