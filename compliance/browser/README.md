# PostHog Browser SDK (posthog-js) Compliance Adapter

Compliance adapter for the posthog-js browser SDK with the [PostHog SDK Test Harness](https://github.com/PostHog/posthog-sdk-test-harness).

Uses jsdom to run the browser SDK in Node.js for testing.

## Running Tests

```bash
# From compliance/browser
docker-compose up --build --abort-on-container-exit
```

## Documentation

See the [test harness documentation](https://github.com/PostHog/posthog-sdk-test-harness) for details.
