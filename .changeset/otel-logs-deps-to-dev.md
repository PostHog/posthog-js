---
'posthog-js': patch
---

Move the OpenTelemetry logs dependencies to `devDependencies`. They are only used to build the CDN-served `logs` extension chunk, which inlines them, so consumers no longer install the transitive `protobufjs` (whose `eval("require")` tripped `unsafe-eval` Content Security Policies).

If you imported `@opentelemetry/*` directly while relying on it being hoisted from `posthog-js`, add it to your own dependencies.
