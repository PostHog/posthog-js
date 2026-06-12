---
'posthog-react-native': patch
---

fix: keep session replay active across `identify()`/`reset()`. The project-level remote config (session replay, error tracking, capture performance) and survey definitions are now preserved across `reset()` instead of being cleared, and replay is re-evaluated whenever feature flags load/reload. A linked flag that becomes active for the identified user now starts (or resumes) recording without an app restart, and a linked flag that turns off pauses recording instead of leaving a gated-off user recorded until restart. Previously replay activation was only evaluated once at startup and the cached config was wiped on `reset()`. The user-specific survey state (which surveys were seen, last-seen date) is still cleared on `reset()`. This now mirrors the native iOS SDK, which keeps the project-level config across an identity change and gates replay on the linked flag once flags have loaded.
