---
'@posthog/core': minor
'posthog-react-native': minor
---

Add automatic exception steps to React Native, so a captured exception carries a timeline even where nobody called `addExceptionStep`. Set `errorTracking.exceptionSteps.automatic` to `true`, or to an object, to record a step for a screen change (`navigation`), an autocaptured tap or React Native Web click (`taps`), an app lifecycle transition (`lifecycle`), or an identity change (`identity`). Every signal stays off by default, because each step adds bytes to every captured exception.

Automatic steps carry `$type`, which the error tracking timeline already renders, and they share the byte-bounded buffer and the native forwarding that manual steps use. A manual step stays untyped. An event that `before_send` dropped leaves no step.

The buffer keeps its existing lifetime. A capture keeps the steps, and `reset()` keeps them too, because steps scope to the app session rather than to the user session. The `identity` signal marks that boundary instead of erasing it: it records a `User changed` step at `reset()`, so the previous user's steps do not read as the next user's. The step carries no distinct ID.
