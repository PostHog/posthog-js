# Node SDK compliance profiles

The adapter loads the built public `posthog-node` package entry. Capture, AI, flags, UUID generation, gzip, retry policy and V1 response handling are SDK-owned. The configured fetch delegates unchanged to Node fetch; decoding is passive accounting only.

```sh
# From this directory: legacy /batch/ contract
docker compose up --build --abort-on-container-exit

# Capture V1 analytics contract
POSTHOG_CAPTURE_MODE=v1 docker compose up --build --abort-on-container-exit
```

CI uses harness **1.0.0** in both jobs, with separate `node-sdk-compliance-report` and `node-sdk-compliance-report-v1` artifacts. Both include all five dedicated AI definitions and the applicable UTC override definitions. Assertion failures remain advisory; missing/incomplete report inventories are blocking setup failures.

| Public entry/runtime | Selected |       Initial result |
| -------------------- | -------: | -------------------: |
| Node V0, native gzip |       52 |  51 passed, 1 failed |
| Node V1, native gzip |      117 | 116 passed, 1 failed |

Both failures are `feature_flags.request_payload.disable_geoip_omitted_defaults_to_false`: the SDK's omitted GeoIP default is **true**. The adapter leaves it unchanged and forwards explicit input. The earlier adapter's configured-false results were 52/52 and 117/117; those did not test the SDK default.

## Mapping

- `flushAt` defaults to 2, `flushInterval` to 100ms, retry count to 3. Explicit harness values are forwarded. V1 uses the supported 250ms initial retry delay; V0 retains its SDK delay.
- Timestamps become the public API's `Date` input. V1 event options map to the SDK's existing sentinel properties.
- Ordinary capture UUIDs come from the SDK's public capture notification, after asynchronous preparation. Dedicated AI returns its SDK-provided UUID.
- State observes captures including `$feature_flag_called`, decodes real gzip bodies, excludes flag requests, and accounts for V1 partial results and retry attempts. Pending counts use the existing public persisted-property getter. Flush reports the per-action sent delta, not a cumulative total.
- Reset discards route queues via existing public persisted-property setters and then shuts down the SDK. The adapter does not advertise parallel scenario isolation.

V0's fixed retry delay passes the current narrow backoff/Retry-After fixtures; this is not evidence of exponential scheduling or general Retry-After parsing. V1 exercises its separate sender.

## Local checks

Build `@posthog/types`, `@posthog/core`, then `posthog-node` with the repository package build commands. With Express 5.2.1 available via `NODE_PATH`:

```sh
node --test compliance/node/adapter.test.js
PORT=18210 node compliance/node/adapter.js
POSTHOG_CAPTURE_MODE=v1 PORT=18211 node compliance/node/adapter.js
```

The focused test uses ports 18215/19215, configurable with `NODE_TEST_ADAPTER_PORT`/`NODE_TEST_MOCK_PORT`. It verifies generated UUIDs, gzip observation, UTC forwarding, native GeoIP, called-event accounting and V1 partial retries through the built package. These tests also run during both Docker builds.

## Additional runtimes

The edge export remains unverified here. The available `@edge-runtime/vm` runtime lacks `CompressionStream`, so it cannot establish edge gzip coverage. Node's `node:zlib` results are not an edge-runtime compression result. React Native has its own Android profile under `compliance/react-native`; it does not inherit these stateless Node results.
