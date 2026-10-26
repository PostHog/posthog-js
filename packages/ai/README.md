# PostHog AI package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [AI observability installation docs](https://posthog.com/docs/ai-observability/installation)
- [AI observability docs](https://posthog.com/docs/ai-observability)

## Privacy mode

Create the client with `new PostHog(key, { privacyMode: true })` to turn on privacy mode for every integration.
Per-call `privacyMode` settings can turn it on for one call, but cannot turn it off.

In privacy mode, events carry no prompts, outputs, or tool inputs and results.
`$ai_error` holds only the error class, HTTP status, provider error code, parameter name, request ID, and cause classes.
Exception autocapture skips these errors, and Vercel AI SDK events omit provider metadata.
For OpenTelemetry, pass `privacyMode: true` to `PostHogTraceExporter`, or to `PostHogSpanProcessor` when its `client` is not in privacy mode.

Remote MCP tool `headers` and `authorization` values are always replaced with `[REDACTED]`.

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

## Genkit

`PostHogGenkitSpanProcessor` from `@posthog/ai/genkit` reads the OpenTelemetry spans that Genkit already creates.
Pass it to Genkit's `enableTelemetry({ spanProcessors: [...] })` from `genkit/tracing`, or to your own OpenTelemetry SDK.

With npm, install with `npm install --legacy-peer-deps`, or add `legacy-peer-deps=true` to `.npmrc`.
Without it, npm stops with `ERESOLVE`: Genkit 1.x installs `@opentelemetry/exporter-trace-otlp-http` 0.52, and `@posthog/ai/otel` declares it as an optional peer `>=0.200.0`.
The Genkit processor does not import OpenTelemetry, so the older version is safe. pnpm only warns.

- The root span of a trace, usually a flow, becomes an `$ai_trace`.
- Each model call becomes an `$ai_generation`. The provider and model come from the Genkit model name, for example `vertexai/gemini-2.5-flash`.
- Each embedder call becomes an `$ai_embedding`, without the vectors. Genkit does not report embedding token counts, so these events have no cost.
- Tool calls, `generate` steps and other Genkit actions become `$ai_span` events.

The `googleai` and `vertexai` plugin names are sent as the `gemini` and `vertex` providers, the same names the other integrations use.
A streamed model call gives one `$ai_generation` with the complete response.
Model parameters include only the common sampling settings.
In span input and output, credential fields such as `apiKey`, `authorization` and `headers` are replaced with `[REDACTED]`.
When `distinctId` is not set, events use the distinct ID from `client.withContext()` if there is one.
In serverless functions, `await flushTracing()` from `genkit/tracing` before the function returns, so the PostHog client sends its queued events.
Capture and flush failures never reach the Genkit flow. Pass `onError` to see them.

## Questions?

### [Check out our community page.](https://posthog.com/posts)

## Datasets, scorers, and offline evaluations

Import the server-only API from `@posthog/ai/evaluations`. It has no model-provider runtime
requirements and does not require a `posthog-node` analytics client. Every network method
returns a Promise that resolves only after a validated server acknowledgment; there is no
capture queue or flush step. Your application executes models and evaluators.

```ts
import { OfflineEvaluations, EvaluationItem } from '@posthog/ai/evaluations'

const evaluations = new OfflineEvaluations({
  projectId: 123,
  secretKey: process.env.POSTHOG_PERSONAL_API_KEY!,
  // host: 'https://eu.posthog.com',
  // timeoutMs: 15_000,
  // maxRetries: 3, // additional attempts, only for operations safe to replay
})

try {
  const snapshot = await evaluations.datasets.snapshot(datasetId)
  const scorer = await evaluations.scorers.get(scorerId)
  const experiment = await evaluations.createExperiment({
    name: 'Answer quality',
    datasetRevisionId: snapshot.revisionId,
    runSource: 'ci',
  })

  for await (const row of snapshot) {
    // Implement these functions in your application.
    const output = await runApplication(row.input)
    const value = await scoreOutput(output, row.expectedOutput)
    await experiment.uploadResult({
      item: EvaluationItem.fromDatasetItem(row, { output }),
      scorerVersionId: scorer.currentVersionId,
      value,
    })
  }
  await experiment.complete()
} finally {
  evaluations.close()
}
```

`datasets` provides create/get/list/update/archive/restore, item management, revision/version
history, and `snapshot`. Item mutations require the current `baseVersion`. Supply a stable
`clientItemId` to make item creation retryable. Snapshots pin both the numeric revision and its
UUID before iteration. `snapshot.iterItems({ pageSize, signal })` fetches one page at a time;
repeated iteration starts again at the same revision. Keep the client open until reads finish.
Use the snapshot's `revisionId` for the experiment, even when individual items were introduced
in earlier revisions. Source output and trace provenance never become a new execution's output.

Set `modelVersion` on `new EvaluationItem({ modelVersion, output })` or
`EvaluationItem.fromDatasetItem(row, { modelVersion, output })` to identify the model used for
that execution. Each item can override the experiment's `modelVersion`; omitted or null values
inherit the experiment default on the server. Dataset metadata never supplies this model.
Model identifiers must be nonempty strings of at most 255 characters and are preserved without
trimming. Explicit models survive serialization, retries, and recovery. Changing a model requires
a new item UUID because model attribution is part of the immutable execution declaration.

`scorers` provides create/get/list/update/createVersion/getVersion/listVersions. Configurations
are typed by `kind`: `boolean`, `numeric`, or `categorical`. Store `currentVersionId` to pin a
configuration. Metadata updates do not create versions; explicit `createVersion` does, including
when the configuration is unchanged. Optional `baseVersion` detects conflicting version writes.
Scorer names are not unique. A result with `status: 'ok'` means the evaluator succeeded; its score
may still fail the pinned scorer's passing rule. Other statuses are `error`, `skipped`, and
`not_applicable`, and carry no score.

| Operation                              | Credential and scope                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| Dataset reads/writes                   | Personal key: `dataset:read` / `dataset:write`                       |
| Scorer reads/writes                    | Personal key: `llm_analytics:read` / `llm_analytics:write`           |
| Experiment create/upload/complete/fail | Personal or project secret key: `offline_evaluation_ingestion:write` |
| Experiment tags                        | Personal key: `evaluation:read` / `evaluation:write`                 |

Feature availability and permissions are enforced by the service. Known ingestion hosts map to
the app API host; custom host path prefixes are preserved. Pagination exposes `nextOffset` or,
for scorer versions, `nextCursor`. Retain the original filters when requesting the next page.

### Recovery, cancellation, and payloads

`resumeExperiment(id)` is local and sends no request. Save creation `submission` and item/result
declarations before relying on process recovery. Use `EvaluationItem.toJSONString()` and
`EvaluationResult.toJSONString()` to save the exact **snake_case wire JSON** compatible with
Python, including large integers. Save attached items separately:

```ts
import { EvaluationItem, EvaluationResult } from '@posthog/ai/evaluations'

const savedItem = item.toJSONString()
const savedResult = result.toJSONString()
// Persist these strings directly; JSON.stringify would wrap them in another JSON string.
const restoredItem = EvaluationItem.fromJSON(JSON.parse(savedItem))
const restoredResult = EvaluationResult.fromJSON(JSON.parse(savedResult), { item: restoredItem })
```

`toJSON()` returns a detached object for inspection and JavaScript-only round trips.
`JSON.stringify()` can write a different integer outside JavaScript's safe integer range,
even when the original value is exactly representable, so use `toJSONString()` for portable
saved declarations. Public options and records use camelCase; arbitrary payload/metadata keys
are never renamed.

`EvaluationAPIError` exposes `status`, `code`, `detail`, `attr`, `errors`, `response`,
`retryAfter` (seconds), and `persistence`: `not_sent`, `rejected`, or `unknown`. Creation errors
also expose `submission`, which can be passed directly to `createExperiment` to reuse the ID
and start time. Error messages omit payloads and credentials. Structured details are explicit
accessors for callers; treat them as potentially sensitive when logging.

`uploadResults` takes a finite array of immutable `EvaluationResult` declarations. The whole
array is validated before I/O, then uploaded sequentially in requests of at most 1,000 items,
1,000 results, and 5 MiB of UTF-8 JSON. Memory usage is proportional to the supplied array, so
submit caller-sized batches. Operations on one experiment handle are serialized.

```ts
import { BulkUploadError } from '@posthog/ai/evaluations'

try {
  await experiment.uploadResults(results)
} catch (error) {
  if (!(error instanceof BulkUploadError)) throw error
  // Earlier chunks are acknowledged; this includes the failed, possibly committed chunk.
  // Persist or inspect this work before deciding when to retry.
  console.log(error.failedIndex, error.persistence)
  await experiment.uploadResults(error.pendingResults)
}
```

Exact replay preserves identities. Changed content for an existing identity conflicts. Ordinary
dataset writes, scorer writes, and experiment tag updates are not automatically replayed. Never
create a fresh ID merely because an acknowledgment was lost. `complete()` and `fail()` are explicit;
closing the client or cancelling a request does neither. Pass `{ signal }` as a network method's
request options, or within listing/snapshot options. Native cancellation propagates without a
retry and does not prove an in-flight write was unpersisted. Retain declarations for replay.

Cancelled creation rejects with `ExperimentCreationAbortedError`, a `DOMException` named
`AbortError` (or the original DOMException name, such as `TimeoutError`). Its `cause` is the
original cancellation reason, and `submission` is a defensive copy of the prepared creation
fields. Save that submission to replay with the same ID and start time. Each cancelled creation
has its own recovery data, including when several requests share one `AbortSignal`.

Omitted fields, explicit nulls, empty payloads, false, and zero remain distinct. `undefined`
omits a top-level optional option, but is rejected inside payload JSON. Payloads accept plain
JSON values without coercion, cycles, accessors, invalid Unicode, NUL characters, or non-finite
numbers. Maximum nesting is 32 containers; item payloads are limited to 1 MiB and result payloads
to 256 KiB, measured in UTF-8 bytes including their payload object.

Counts accept safe integer `number` values or nonnegative signed-64-bit `bigint`; large returned
counts remain `bigint`. Use a lossless JSON codec when persisting submissions or receipts containing
bigint counts. Numeric scores accept finite numbers; use `bigint` for integer inputs outside the
safe number range, which are accepted only when exactly representable as binary64. Unsafe integer
`number` score inputs are rejected because their original precision cannot be recovered. Bigints
are not accepted in arbitrary JSON payloads. An unrepresentable integer in returned dataset JSON
raises an invalid-response error rather than silently rounding it.
