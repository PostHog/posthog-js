# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## Claude Agent SDK

The `@posthog/ai/claude-agent-sdk` integration accepts string and streamed prompts.
Each turn has its own captured input, output, and cost, calculated from the SDK's cumulative cost total.
Generation latency includes the SDK's reported time to first token.

Stopping iteration finalizes the generation data received so far.
When iterating manually, await the query's `return()` or `Symbol.asyncDispose` method before shutting down PostHog.
The SDK's synchronous `close()` method also starts finalization; await `return()` afterward to wait for it.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
