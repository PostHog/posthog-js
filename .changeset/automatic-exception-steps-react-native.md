---
'@posthog/core': minor
'posthog-react-native': minor
---

Add automatic exception steps to React Native, so a captured exception carries a timeline even where nobody called `addExceptionStep`. Set `errorTracking.exceptionSteps.automatic` to `true`, or to an object, to record a step for a screen change (`navigation`), an autocaptured tap (`taps`), or an app lifecycle transition (`lifecycle`). Every signal stays off by default, because each step adds bytes to every captured exception.

Automatic steps carry `$type`, which the error tracking timeline already renders, and they share the byte-bounded buffer and the native forwarding that manual steps use. A manual step stays untyped. An event that `before_send` dropped leaves no step.

`reset()` now clears the exception-step buffer, for automatic and manual steps alike. Exception steps are user-session state, so on a shared device the previous user's screen names and tap labels must not reach the next user's exception. The buffer still survives a capture, so every exception in one session carries the same steps.
