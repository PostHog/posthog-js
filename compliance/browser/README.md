# Browser SDK compliance profile

Runs the built `packages/browser/dist/array.js` in real headless Chromium. Playwright controls public SDK calls and passively observes requests; the SDK owns event preparation, batching, encoding and retries.

```sh
# From this directory
docker compose up --build --abort-on-container-exit
```

CI uses harness **1.0.0**, selects all **27 client V0 cases**, and uploads `browser-sdk-compliance-report`. Assertion failures remain advisory; missing or incomplete inventories fail the report gate. The Docker build also runs `adapter.test.js` against the built SDK and a local HTTP fixture.

## Configuration and boundaries

- **First-party/same-origin**: the page navigates to the mock's origin and loads the SDK script from the controller. The mock does not provide CORS headers; cross-origin requests produce OPTIONS but no POST. Browser security and all capture request bytes remain unchanged.
- Memory persistence; pageview/pageleave, autocapture, flags, external extensions and recording disabled. `opt_out_useragent_filter: true` permits headless Chromium capture.
- Identity uses public `register({ distinct_id })`. Explicit timestamps use the public capture option with a `Date`. Calls without timestamp options retain default SDK batching and its numeric `offset` representation.
- The SDK clamps the requested timer interval to 250–5000ms. It does not expose the harness's `flush_at` or `max_retries` controls; these are not implemented by the controller.
- **Partial flush mapping**: `/flush` waits at most 12 seconds for terminal HTTP outcomes of every observed capture UUID. It neither forces a send nor treats network idleness as completion. Unobserved outcomes, pending retries or decoding failures return HTTP 504. No public blocking flush exists; this profile does not claim that portion of adapter-contract conformance.
- Reset closes the isolated browser context, cancelling its runtime without invoking SDK unload/shutdown transport.
- Flags and compression assertions are server-wire-only in this harness. This client profile advertises only `capture_v0`.

## Expected disagreements

The initial same-origin run selected 27 cases: **21 passed, 6 failed**:

- `capture.format_validation.event_has_timestamp`: native timer batches use offsets.
- `capture.retry_behavior.respects_retry_after_header`: native 429 is terminal.
- `capture.error_handling.retries_on_408`: native 408 is terminal.
- `capture.retry_behavior.implements_backoff`
- `capture.retry_behavior.max_retries_respected`
- `capture.deduplication.preserves_uuid_and_timestamp_on_retry`

The final three exceeded the observation bound with native retries pending. Counts can vary with the SDK's jittered retry schedule; all cases remain selected. Passing retry timestamp comparisons do not establish offset-time stability: the harness compares only events containing literal timestamps. Explicit UTC timestamp forwarding is covered separately and passes.

## Local adapter checks

Build using the Dockerfile's repository commands, or use an existing local build. Install Express 5.2.1 and Playwright 1.61.1 in a separate tools directory, install its Chromium binary, and set `NODE_PATH` to that directory's `node_modules`:

```sh
node --test compliance/browser/adapter.test.js
PORT=18212 node compliance/browser/adapter.js
```

The regression test uses ports 18214/19214 (override with `BROWSER_TEST_ADAPTER_PORT`/`BROWSER_TEST_MOCK_PORT`). It verifies real same-origin requests, default offsets, explicit UTC timestamps, SDK retries, terminal responses and explicit drain timeouts.
