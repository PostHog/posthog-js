---
'posthog-react-native': patch
---

Expo plugin: `skipOnConflict` now also applies to native iOS dSYM uploads. With `uploadNativeSymbols` enabled, a release build whose dSYM already exists in PostHog with different content no longer fails — the upload is skipped and the existing symbols are kept. Requires posthog-ios >= 3.64.7 and posthog-cli >= 0.7.12; with older posthog-ios versions the option has no effect on dSYM uploads. Changes to `skipOnConflict` or `uploadNativeSymbols.includeSource` now take effect on the next `expo prebuild` without `--clean`; build phases you have customized by hand are never modified.
