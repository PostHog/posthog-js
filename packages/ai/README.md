# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## Tool-result capture

Gemini, OpenAI Chat Completions and Responses, direct Anthropic, and Claude Agent SDK
use the same string limits for tool results captured in generation input.
The Azure integrations that share the OpenAI capture paths use the same policy.
Each string value retains up to 5,000 UTF-8 bytes, followed by the existing
truncation marker when shortened (up to 5,015 bytes before JSON encoding).
Objects and arrays retain their structure and later fields; arbitrary text is not
parsed into JSON. Provider-specific roles, linking IDs, error flags, and media
metadata are preserved. These limits affect analytics capture, not the requests
sent to providers or the results returned to the application.
OpenAI Responses keeps its existing serialized analytics input representation;
tool-output string values are capped before that formatting.

Traversal safeguards and binary redaction still apply. Full AI capture bypasses
binary redaction and string caps, while privacy mode takes precedence and omits
input and output content. Full capture does not disable traversal safeguards.

This is a per-string limit, not a whole-result or whole-event size guarantee.
Many small fields or repeated results can still produce large events, and events
that exceed transport limits may be dropped.

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
Strings in assistant output and original tool-span inputs/outputs retain their
separate 200,000 UTF-8-byte limit. Tool results repeated in generation input use
the shared 5,000-byte per-string policy above.
Full AI capture removes these string limits.

Generation metrics cover the main agent.
The SDK does not forward subagent token streams, and its reported trace cost also includes subagent and internal calls, so it can exceed the sum of captured generation costs.
See the SDK's [streaming limits](https://code.claude.com/docs/en/agent-sdk/streaming-output) and [cost accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

Stopping iteration finalizes the generation data received so far.
When iterating manually, await the query's `return()` or `Symbol.asyncDispose` method before shutting down PostHog.
The SDK's synchronous `close()` method also starts finalization; await `return()` afterward to wait for it.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
