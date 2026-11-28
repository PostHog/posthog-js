# Browser-common

Internal shared browser code: the Extension and Client contract that browser extensions are written against, and the extensions shared across browser SDK generations.

## entrances

- flags responses: PostHog servers answer `/flags?v=4` with each flag's typed value, reason and rule metadata, or with the older record when they do not serve v4
  handler: readFlagRecords in src/flags-response-v4.ts
  trust: posthog-api
  control: none — a typed record with a known field of the wrong JSON type reads as a disabled flag and leaves the other flags readable

## invariants
