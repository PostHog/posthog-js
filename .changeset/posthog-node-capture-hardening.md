---
'posthog-node': major
---

A personal API key (`phx_...`) passed as the project API key now disables the client, like a missing key, and either case logs one error that never includes the key.
Debug mode logs event names, uuids and counts instead of whole events, and a `before_send` function that throws is logged with the error's type instead of its message, so logs never carry event content.
The Express and NestJS integrations take a new `captureTracingHeaders` option (default `true`): set it to `false` to stop reading the `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` request headers into the request context.
