---
'posthog-react-native': minor
'@posthog/core': minor
---

Add manual log capture API for React Native: `posthog.captureLog()`, `posthog.logger.{trace,debug,info,warn,error,fatal}()`, `posthog.flushLogs()`, and a `logs` config option on the constructor. Records ship to PostHog's logs product (`/i/v1/logs`) in OTLP format, batched on a timer / AppState change / buffer fill, persisted to a dedicated logs-storage file, and tagged with `service.name`, `os.*`, `telemetry.sdk.*`, plus per-record `posthogDistinctId`, `sessionId`, `screen.name`, `app.state`, `feature_flags`. AppState backgrounding races against an iOS-budget; `shutdown()` drains both events and logs.

Manual capture is unconditional — calling the API ships records, matching the browser SDK's manual path. The server can remotely block capture by returning `response.logs.captureConsoleLogs: false`; an explicit `true` and an absent key both leave it allowed.
