---
'posthog-node': minor
---

feat(node): add a logs API, `posthog.logger.info(...)` and `posthog.captureLog(...)`, configured with the `logs` option. Records attach the active span's trace and span ids and the `withContext` distinctId and sessionId, and `serviceName` defaults to the traces or metrics one.
