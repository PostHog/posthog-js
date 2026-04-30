---
'posthog-react-native': minor
'@posthog/core': minor
---

Add manual log capture API for React Native: `posthog.captureLog()`, `posthog.logger.{trace,debug,info,warn,error,fatal}()`, `posthog.flushLogs()`, and a `logs` config option on the constructor. Records ship to PostHog's logs product (`/i/v1/logs`) in OTLP format, batched on a timer / AppState change / buffer fill, and persisted to a dedicated logs-storage file.

Manual capture is unconditional — calling the API ships records, matching the events pipeline's manual `capture()` shape. Only blockers: `optedOut`, missing/empty `body`, and missing API key. The wire field `response.logs.captureConsoleLogs` is browser-only (it gates the JS SDK's `console.*` autocapture extension) and is not read by RN. When console autocapture lands on RN as a follow-up, that PR will introduce a local opt-in for the autocapture path specifically; manual capture will remain unconditional.
