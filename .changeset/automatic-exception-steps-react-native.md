---
'@posthog/core': minor
'posthog-react-native': minor
---

Add automatic exception steps to React Native, so a captured exception carries a timeline even where nobody called `addExceptionStep`. Set `errorTracking.exceptionSteps.automatic` to `true`, or to an object, to record a step for a screen change (`navigation`), an autocaptured tap or React Native Web click (`taps`), or an app lifecycle transition (`lifecycle`). Every signal stays off by default, because each step adds bytes to every captured exception.

Automatic steps carry `$type`, which the error tracking timeline already renders, and they share the byte-bounded buffer and the native forwarding that manual steps use. A manual step stays untyped. An event that `before_send` dropped leaves no step.

The buffer keeps its existing lifetime. A capture keeps the steps, and `reset()` keeps them too, because steps scope to the app session rather than to the user session.
