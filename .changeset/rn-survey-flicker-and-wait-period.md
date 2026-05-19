---
'posthog-react-native': patch
---

React Native surveys:

- `PostHogSurveyProvider` now defaults `androidKeyboardBehavior` to `'padding'` instead of `'height'`. The old default thrashed the modal layout on every keyboardWillShow/keyboardDidShow event and produced a flicker that made some popups unusable on Android. Consumers who explicitly passed `'height'` are unaffected.
- Survey `seenSurveyWaitPeriodInDays` is now honored on React Native, matching Web/iOS/Android/Flutter. It had silently been a no-op since the `posthog-js-lite` migration.
- `SurveyModal` is keyed by the active survey ID so a fresh memoized context object cannot accidentally remount the modal mid-answer.
