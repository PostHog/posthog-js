# PostHog Next.js package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [Next.js library docs](https://posthog.com/docs/libraries/next-js)

The optional `@posthog/next/otel` entry point links Node.js App Router work to existing OpenTelemetry spans. Reuse your `createPostHog` configuration and add its processor to your existing tracer provider. Request context ends when `withPostHogContext` returns or throws. It does not cover later component rendering, streamed response bodies, or the Edge runtime.
