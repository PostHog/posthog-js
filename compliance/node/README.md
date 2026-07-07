# PostHog Node SDK Compliance Adapter

Compliance adapter for the posthog-node SDK with the [PostHog SDK Test Harness](https://github.com/PostHog/posthog-sdk-test-harness).

## Running Tests

```bash
# From compliance/node — legacy /batch/ contract (capture_v0)
docker-compose up --build --abort-on-container-exit

# Capture V1 contract (POST /i/v1/analytics/events)
POSTHOG_CAPTURE_MODE=v1 docker-compose up --build --abort-on-container-exit
```

The adapter's capture mode is fixed per process: with `POSTHOG_CAPTURE_MODE=v1`
it advertises the `capture_v1` capability and the harness runs the V1 contract;
otherwise it advertises `capture_v0`. CI runs both as separate jobs
(`Dockerfile` for v0, `Dockerfile.v1` for v1).

## Documentation

See the [test harness documentation](https://github.com/PostHog/posthog-sdk-test-harness) for details.
