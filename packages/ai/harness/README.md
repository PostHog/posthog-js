# AI SDK HTTP cassettes

This private harness replays recorded provider responses through the real Anthropic and OpenAI SDKs,
the built `@posthog/ai` wrappers, and `posthog-node` HTTP transport.
It complements the existing unit and live tests; it does not replace them.

```text
Scenario process
  → built @posthog/ai wrapper
  → real provider SDK
  → local provider replay server

Wrapper analytics
  → real posthog-node client
  → local HTTP collector
  → independent event assertions
```

The collector is not the PostHog backend. These tests verify emitted usage and
events, not server pricing, billing, or production ingestion.

## Run offline

Use the repository's Node 24 and pnpm versions. From the repository root:

```sh
pnpm install --frozen-lockfile --config.enable-global-virtual-store=false
pnpm_config_enable_global_virtual_store=false pnpm exec turbo run build --filter=@posthog/ai --env-mode=loose
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai test:cassettes:offline
```

Docker must be available. Installing dependencies and pulling the pinned image
need network access; the tests run inside `--network=none`. The unprivileged
container has read-only mounts containing the harness, dependencies, manifests,
and current build outputs, not the checkout's `.git` or `.env` files. No provider
or PostHog credentials are passed into it. The integration scenario runs in a
separate process with a minimal environment containing local endpoints and scenario inputs.
SELinux labeling is disabled to avoid relabeling shared checkout files. This
container enforces offline testing; it is not a sandbox for hostile code.

The checkout-local pnpm store keeps dependency symlinks inside these mounts.
The build command passes that setting through Turbo; it does not change the
repository's package-manager configuration.

For faster iteration without the container:

```sh
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai test:cassettes
```

That command does **not** guarantee network isolation. CI uses the container
command, which also tests that an external TCP connection is denied.

Run this suite separately from `test:unit`: the existing build-artifact tests
delete and rebuild `dist`, which the replay scenarios import.

## Anthropic recordings

The thirteen JSON fixtures were recorded from Anthropic using artificial prompts,
`claude-haiku-4-5-20251001`, and provider SDK `0.124.0`. Each retains its recording
timestamp and provenance. They cover:

- Plain text without caching.
- 5-minute and 1-hour cache writes, hits, and partial hits with new writes.
- Mixed TTL writes, a full hit, and a partial hit with writes to both TTLs.
- A prompt below the caching minimum, which creates no cache entry.
- A response stopped by `max_tokens`.
- A forced client tool call with fragmented JSON arguments.

Expected analytics values live separately in `anthropic-stream.test.ts` and `anthropic-tools.test.ts`; they
were checked against provider usage, not generated from the wrapper under test.
The twelve text/cache scenarios verify exactly one generation, text, stop reason, input/output
tokens, aggregate cache counters, and the raw TTL breakdown.
The live tool scenario checks one generation, usage, stop reason, tool ID, name,
parsed arguments and request tool definitions. A separate synthetic case checks mixed text and two tool calls
with distinct IDs and arguments. No tool is actually executed.

`cassette.test.ts` also records real SDK requests against a local synthetic
upstream, stops that upstream, and replays the saved file through the real SDK.
These synthetic tests verify the recorder itself, including malformed streams,
credential rejection, redirects, and incomplete writes. They do not substitute
for the recorded provider responses in the integration scenarios.

Cassettes contain the request method, path, body, selected API headers,
response status, JSON/text responses or SSE frames, and provenance. Matching compares JSON values,
including the model, prompt, and options, rather than object property order.
Missing files, mismatches, additional requests, and unused responses fail the
test. Replay never falls back to the internet or rewrites files.

## OpenAI recordings

The 24 OpenAI fixtures were captured with SDK `6.49.0`, artificial prompts, and
an artificial speech file. They cover the endpoints currently instrumented by
`@posthog/ai/openai`, not the entire OpenAI API:

| Surface              | Recorded cases                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions     | Text and streaming, forced and parallel function calls, structured parsing, cache hit, token limit                               |
| Responses            | Text and streaming, function calls in both modes, structured parsing, reasoning, incomplete output, explicit cache write and hit |
| Background Responses | Creation, polling through completion, repeated terminal retrieval, cancellation                                                  |
| Embeddings           | Small float vector returned to the caller; `$ai_embedding` telemetry without the vector                                          |
| Transcriptions       | JSON, streaming, verbose JSON, text, SRT, and VTT                                                                                |

`openai-replay.test.ts` keeps independent expected token counts and checks both
caller results and events delivered by the real PostHog client. Additional local
SDK tests cover background streaming retrieval, interleaved tools, errors,
incremental delivery, identity, privacy, and caller overrides. Controlled error
responses are synthetic; successful provider fixtures are live recordings.

Two existing SDK behaviors are deliberately not fixed by this test-only change:
plain-text/SRT/VTT transcription results do not emit success telemetry, and an
HTTP error before an initial Chat/Responses/transcription stream starts does not
emit a failed generation. Error tests verify the caller receives the real SDK
exception; they do not treat missing error telemetry as the desired contract.

Multipart requests are matched by field values and each file's name, MIME type,
length, and SHA-256, not the random boundary. Audio bytes are not stored in the
cassette. The separately committed `openai-audio.wav` says only
“The weather in Paris is sunny.” It was generated locally with Flite, not recorded
from a person:

```sh
ffmpeg -f lavfi -i "flite=text='The weather in Paris is sunny.':voice=slt" \
  -ar 16000 -ac 1 -c:a pcm_s16le openai-audio.wav
```

## Record live responses

This is a separate, explicit operation, never part of CI. With
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` already set in your environment:

```sh
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai cassette:record anthropic-stream
# Refresh all eleven cache and max_tokens scenarios, in order:
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai cassette:record anthropic-cache
# Record one forced get_weather call using artificial Paris/celsius arguments:
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai cassette:record anthropic-tools
```

The greeting command sends the fixed artificial prompt `Say hello.` to
`https://api.anthropic.com`. All recording commands incur provider charges. The greeting writes
`fixtures/anthropic-stream.live.json`, not the checked-in recording.
Live files are gitignored to prevent accidental staging.
It then replays that file through the Anthropic SDK with a fake key and compares
the received events. This checks transport replay, not analytics correctness.

Before adopting a live file, review its entire contents, use its exact request/model
in a regression scenario, and write independent expected analytics values.
Copy the reviewed recording to a named fixture without the `.live.json` suffix
and commit it alongside that scenario and its assertions.
Recording does not automatically update test expectations. The cache command uses
the artificial requests in the committed fixtures, with the selected model and a
fresh shared prefix. It sends eleven sequential requests: 5-minute write, hit,
extension; 1-hour write, hit, extension; mixed write, hit, extension; below-minimum
prompt; and `max_tokens`. The mixed extension reuses the earlier 1-hour prefix.
Do not pause between calls: hits must happen before the cache expires.

Before saving each file, the command checks the expected presence of cache reads
and writes for each TTL, the aggregate write count, and the stop reason. It fails
if the chosen model or provider response does not produce the intended state.
It does not retry until it gets a convenient result. Successful files are written
individually as `anthropic-<scenario>.live.json`; a later failure leaves earlier
live files in place but does not change committed fixtures. Start the command
again to get a new prefix and a complete sequence. Replaying a fixture does not
populate the live cache.

The tool command writes `fixtures/anthropic-tools.live.json`. Before saving, it
requires one `get_weather` call with exactly `{ "city": "Paris", "unit": "celsius" }`
and the `tool_use` stop reason. It rejects a response that misses this contract
rather than retrying. The recorder checks reconstructed JSON arguments, including
escaped strings and values overwritten by duplicate keys, for credentials.
This still requires human review; it is not a general data-loss-prevention tool.

### OpenAI

With `OPENAI_API_KEY` already in the environment, from the repository root:

```sh
node packages/ai/harness/record-openai.mjs openai-chat-text
node packages/ai/harness/record-openai.mjs all
```

The available names and artificial requests are in `openai-scenarios.mjs`.
Recording incurs provider charges and writes ignored `openai-*.live.json` files.
Each accepted recording is immediately replayed through the real OpenAI SDK with
a fake key, comparing caller results. This is separate from analytics validation.

Cache scenarios use a fresh prefix and stop after at most four calls. They fail
if the intended positive counters are absent; cache availability is not assumed.
The explicit cache scenario requires both a write and a hit. The reasoning case
requires nonzero reasoning tokens. Model access and these provider behaviors are
prerequisites for refreshing those fixtures, not for offline CI.

Non-background Responses use `store: false`. Background scenarios require
`store: true`, poll at most ten times, and cancel/delete only response IDs created
by that invocation. A cleanup failure fails the command. All content is artificial;
this is not a general-purpose recorder for customer requests. Provider SDK logging
is disabled, including when `OPENAI_LOG` is set, so malformed response bodies cannot
bypass the recorder's safe error messages.

## Updating fixtures

Do not refresh cassettes on a schedule or simply because a test fails. Investigate
the failure first. Re-record when deliberately updating the request or provider
SDK, or when a verified provider contract change needs new coverage. Include the
reviewed fixture and separate assertion changes in the same PR, then run offline
replay. CI replays committed files and cannot discover unrecorded provider changes.

An incomplete transport response, provider error, redirect, or detected credential rejects
the recording and leaves the previous file intact. Files are written atomically
only after response and stream completion validation. A completed stream whose
semantic result is `incomplete` (such as a token limit) is supported. Credential headers are omitted; known
secrets and suspicious fields are rejected, not silently replaced. This is not
general PII sanitization: use artificial prompts and review every recorded file.

## Diagnosis and maintenance cost

Replay/recorder request failures report a one-based interaction number and a safe
category: `request`, `mismatch`, `stream`, `secret`, `response`, or `transport`.
They never include a request body, credentials, or the provider's raw error.
For a mismatch, compare the scenario's request with the committed request. For a
stream failure, inspect framing and completion. For a secret failure, do not
promote the file. A response failure means the upstream did not return successful
response data; transport failures include timeouts and disconnections. The live CLI prints
only a generic failure message because SDK exceptions can contain raw responses.

The thirteen Anthropic fixtures total 444,391 bytes (about 434 KiB).
The OpenAI JSON fixtures total about 145 KiB, plus a 59 KiB artificial WAV file.
No new dependency or published SDK code is added.

The controlled incremental test withholds the end of a recorded response until
the built wrapper delivers its first text delta. It then checks final text,
usage, and exactly one generation. This proves delivery before completion, not
provider latency. Recorder tests still use synthetic upstream responses; CLI
tests exercise the complete cache sequence with recorded responses and fake
credentials, not a live cache. Live refresh remains an explicit manual check.
The tool incremental test similarly withholds completion until the caller receives
the first nonempty argument fragment, then checks both tools and their analytics.
Malformed tool streams and split or escaped credentials have separate synthetic
recorder tests that verify an existing file is not replaced on failure.

## Boundaries

The recorder supports sequential successful Anthropic SSE with text and client
`tool_use` blocks, and the OpenAI routes above:
up to 16 interactions, 1 MiB per request, 8 MiB of accumulated response bytes,
16 MiB per serialized cassette, and a 15-second request deadline. It preserves
SSE content and order, not original packet boundaries, timing, or latency. It
rejects unsupported content-block types. This does not cover every model or option
combination, Anthropic server tools or tool-result conversations, hosted OpenAI tools,
Azure, Realtime, Agents SDK, image generation,
speech generation, LangChain, Bedrock, or installed package tarballs. Those need
explicit scenarios rather than expanding these fixtures' meaning. Replay proves
the recorded protocol still works with the current SDK, not that a live provider
has not changed since recording.

Tool arguments must complete as a JSON object. Fine-grained streams stopped with
partial JSON are not successful tool fixtures. The zero-argument recorder test
exercises the unwrapped Anthropic SDK, not the built PostHog wrapper.
