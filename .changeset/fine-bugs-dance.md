---
'posthog-react-native': patch
---

**Bug Fixes:**

- Fixed surveys with URL or CSS selector targeting incorrectly showing in React Native
    - **Breaking behavior change**: Surveys configured with URL or CSS selector targeting will no longer appear in React Native apps (this was always the intended behavior)
    - **Action required**: If you have surveys that should show in React Native, remove URL/selector conditions and use feature flags or device type targeting instead
