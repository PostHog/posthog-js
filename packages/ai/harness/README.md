# Anthropic HTTP cassette pilot

This private harness replays recorded Anthropic streaming responses through the real Anthropic SDK,
the built `@posthog/ai/anthropic` wrapper, and `posthog-node` HTTP transport.
It complements the existing unit and live tests; it does not replace them.

```text
Scenario process
  → built @posthog/ai Anthropic wrapper
  → real Anthropic SDK
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
separate process with only the two local endpoint URLs and the recorded request in its environment.
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

## What is committed

The twelve JSON fixtures were recorded from Anthropic using artificial prompts,
`claude-haiku-4-5-20251001`, and provider SDK `0.124.0`. Each retains its recording
timestamp and provenance. They cover:

- Plain text without caching.
- 5-minute and 1-hour cache writes, hits, and partial hits with new writes.
- Mixed TTL writes, a full hit, and a partial hit with writes to both TTLs.
- A prompt below the caching minimum, which creates no cache entry.
- A response stopped by `max_tokens`.

Expected analytics values live separately in `anthropic-stream.test.ts`; they
were checked against provider usage, not generated from the wrapper under test.
Each scenario verifies exactly one generation, text, stop reason, input/output
tokens, aggregate cache counters, and the raw TTL breakdown.

`cassette.test.ts` also records real SDK requests against a local synthetic
upstream, stops that upstream, and replays the saved file through the real SDK.
These synthetic tests verify the recorder itself, including malformed streams,
credential rejection, redirects, and incomplete writes. They do not substitute
for the recorded provider responses in the integration scenarios.

Cassettes contain the request method, path, JSON body, selected API headers,
response status, SSE frames, and provenance. Matching compares JSON values,
including the model, prompt, and options, rather than object property order.
Missing files, mismatches, additional requests, and unused responses fail the
test. Replay never falls back to the internet or rewrites files.

## Record live responses

This is a separate, explicit operation, never part of CI. With
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` already set in your environment:

```sh
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai cassette:record anthropic-stream
# Refresh all eleven cache and max_tokens scenarios, in order:
pnpm_config_enable_global_virtual_store=false pnpm --filter @posthog/ai cassette:record anthropic-cache
```

The greeting command sends the fixed artificial prompt `Say hello.` to
`https://api.anthropic.com`. Both commands incur provider charges. The greeting writes
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

## Updating fixtures

Do not refresh cassettes on a schedule or simply because a test fails. Investigate
the failure first. Re-record when deliberately updating the request or provider
SDK, or when a verified provider contract change needs new coverage. Include the
reviewed fixture and separate assertion changes in the same PR, then run offline
replay. CI replays committed files and cannot discover unrecorded provider changes.

An incomplete response, provider error, redirect, or detected credential rejects
the recording and leaves the previous file intact. Files are written atomically
only after SSE framing and message completion validation. Credential headers are omitted; known
secrets and suspicious fields are rejected, not silently replaced. This is not
general PII sanitization: use artificial prompts and review every recorded file.

## Diagnosis and maintenance cost

Replay/recorder request failures report a one-based interaction number and a safe
category: `request`, `mismatch`, `stream`, `secret`, `response`, or `transport`.
They never include a request body, credentials, or the provider's raw error.
For a mismatch, compare the scenario's request with the committed request. For a
stream failure, inspect framing and completion. For a secret failure, do not
promote the file. A response failure means the upstream did not return successful
SSE; transport failures include timeouts and disconnections. The live CLI prints
only a generic failure message because SDK exceptions can contain raw responses.

The twelve committed fixtures total 440,261 bytes (about 430 KiB). An offline run
on Node 24 took about five seconds on a developer machine, excluding dependency
installation, Docker image download, and SDK builds. This is a local measurement,
not a CI performance guarantee. No new dependency or published SDK code is added.

The controlled incremental test withholds the end of a recorded response until
the built wrapper delivers its first text delta. It then checks final text,
usage, and exactly one generation. This proves delivery before completion, not
provider latency. Recorder tests still use synthetic upstream responses; CLI
tests exercise the complete cache sequence with recorded responses and fake
credentials, not a live cache. Live refresh remains an explicit manual check.

## Boundaries

The first pilot supports sequential successful text-only Anthropic SSE message requests:
up to 16 interactions, 1 MiB per request, 8 MiB of accumulated response bytes,
16 MiB per serialized cassette, and a 15-second request deadline. It preserves
SSE content and order, not original packet boundaries, timing, or latency. It
rejects unsupported content-block types and does not claim coverage of every stream API, tools, retries, errors, other
providers, LangChain, Bedrock, or installed package tarballs. Those need explicit
scenarios rather than expanding this fixture's meaning.
