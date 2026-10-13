# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## Gemini Interactions

`PostHogGoogleGenAI.interactions.create` traces foreground model calls with `@google/genai` 2.18 or later in the 2.x series.
Existing `models` calls remain compatible with the supported 1.x SDK range.
Agent and background interactions are rejected because their completion requires separate lifecycle tracking.

Regular and streamed calls capture text, tool-call IDs, media metadata, and reported token usage.
Interrupted streams retain the usage observed before cancellation or failure; these counts may be incomplete.
Provider requests, responses, and stream events are preserved.
Privacy mode suppresses input/output even when full AI capture is enabled.

Modality pricing and image previews depend on corresponding PostHog ingestion and viewer support.
Recognizing an audio or image token count does not establish that the selected model has a dedicated catalog rate.

## Claude Agent SDK

The `@posthog/ai/claude-agent-sdk` integration accepts string and streamed prompts.
Each turn has its own captured input, output, and cost, calculated from the SDK's cumulative cost total.
Generation latency includes the SDK's reported time to first token.

Give queued prompts a `uuid` so the SDK can match replies to their input, including reordered prompts.
When a reply cannot be matched and several prompts are pending, ambiguous prompt content is omitted.
With a function-based `distinctId`, events wait for the turn's result and share its resolved identity.
If the query stops without a result or the resolver throws, those events are captured anonymously.

Tool spans include elapsed time and the returned output when available.
Tools without a result are finalized with their observed elapsed time when the turn or iteration ends.
Strings in assistant output and tool inputs/outputs are limited to 200,000 UTF-8 bytes, with a 5,000-byte limit for tool results in generation input.
Full AI capture removes these string limits.

Generation metrics cover the main agent.
The SDK does not forward subagent token streams, and its reported trace cost also includes subagent and internal calls, so it can exceed the sum of captured generation costs.
See the SDK's [streaming limits](https://code.claude.com/docs/en/agent-sdk/streaming-output) and [cost accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

Stopping iteration finalizes the generation data received so far.
When iterating manually, await the query's `return()` or `Symbol.asyncDispose` method before shutting down PostHog.
The SDK's synchronous `close()` method also starts finalization; await `return()` afterward to wait for it.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
