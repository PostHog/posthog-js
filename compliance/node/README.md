# PostHog Node SDK Compliance Adapter

Compliance adapter for the posthog-node SDK with the [PostHog SDK Test Harness](https://github.com/PostHog/posthog-sdk-test-harness).
It runs the capture v1 suites (`capture_v1`, `capture_ai_v1`) and the feature flag suites.

## Running Tests

```bash
# From compliance/node
docker-compose up --build --abort-on-container-exit

# Another codec for the compression tests
COMPRESSION=zstd docker-compose up --build --abort-on-container-exit
```

Each adapter process runs one codec (`COMPRESSION`: `gzip`, `deflate` or `zstd`, default `gzip`) and advertises only that `encoding_<codec>` capability.
CI runs one job per codec (`.github/workflows/sdk-compliance-tests-node.yml`).
The Gherkin harness adapter lives in `v2/`.

## Documentation

See the [test harness documentation](https://github.com/PostHog/posthog-sdk-test-harness) for details.
