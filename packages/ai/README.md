# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## Tool-result capture

Tool results share JSON-safe normalization and binary redaction while retaining
provider-specific size limits pending agreement on a shared capture policy:

- Gemini retains its 5,000 UTF-8-byte whole-result ceiling. Small results preserve
  their structure; oversized serialized results become a marked text preview
  (up to 5,015 bytes before the event is JSON encoded). This also bounds combined
  `response` and `parts` payloads, so later fields can be omitted.
- Claude Agent SDK retains up to 5,000 UTF-8 bytes per string value, followed by
  the existing truncation marker (up to 5,015 bytes before JSON encoding). Objects
  and arrays preserve their structure and later fields.
- OpenAI Chat Completions and Responses, including Azure's shared capture paths,
  and direct Anthropic retain their existing string capture behavior. This change
  does not introduce a new 5 KB cap on opaque tool-output strings or text blocks.
  Responses keeps its existing serialized analytics input representation.

Only provider-recognized result payloads are normalized, including Anthropic MCP
and server-tool results and Responses code-interpreter outputs and file-search
results. Arbitrary text is not parsed into JSON. Roles, linking IDs, error flags,
and media metadata are preserved. Analytics preparation does not change provider
requests or application results.

Traversal safeguards still apply. Full AI capture bypasses binary redaction and
size caps, while privacy mode takes precedence and omits input and output content.
Full capture does not disable traversal safeguards.

These limits are not a whole-event size guarantee. Many small fields, long opaque
strings, or repeated results can still produce large events, and events that
exceed transport limits may be dropped. A uniform history or event budget needs
an agreed retention policy before changing these existing limits.

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
its existing 5,000-byte per-string history limit described above.
Full AI capture removes these string limits.

Generation metrics cover the main agent.
The SDK does not forward subagent token streams, and its reported trace cost also includes subagent and internal calls, so it can exceed the sum of captured generation costs.
See the SDK's [streaming limits](https://code.claude.com/docs/en/agent-sdk/streaming-output) and [cost accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

Stopping iteration finalizes the generation data received so far.
When iterating manually, await the query's `return()` or `Symbol.asyncDispose` method before shutting down PostHog.
The SDK's synchronous `close()` method also starts finalization; await `return()` afterward to wait for it.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
