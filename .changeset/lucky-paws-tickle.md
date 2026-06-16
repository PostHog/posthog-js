---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

Add `addExceptionStep(message, properties?)` for breadcrumb-style exception steps. Steps accumulate in a rolling, byte-bounded buffer (configurable via `errorTracking.exceptionSteps`) and are attached to every captured `$exception` as `$exception_steps`, giving the error tracking UI a timeline of recent activity before each error. When native crash capture is enabled, steps are forwarded to the embedded native SDK so native crashes carry the same timeline.
