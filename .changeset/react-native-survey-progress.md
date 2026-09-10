---
'posthog-react-native': minor
'@posthog/core': patch
---

Support partial survey responses and persistent resume in React Native, moving surveys toward feature parity across SDKs. When partial responses are enabled, send cumulative answers after each submitted question with a stable submission ID and completion status. Restore unfinished surveys at the next question after restarting the app; clear progress on completion, dismissal, reset, or opt-out.
