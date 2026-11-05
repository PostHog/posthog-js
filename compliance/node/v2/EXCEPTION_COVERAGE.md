# Node exception coverage

This inventory separates test execution from conformance. A passing harness or
adapter test does not override a failing canonical assertion. The source of truth
is `PostHog/sdk-specs/openspec/specs/{capture-exception,exception-event-metadata,exception-steps}/spec.md`.

## Validation snapshot (2026-11-05)

The expansion is integrated locally on main
`5663aff913ea5c6ca14dba286829cf7993bea980`, preserving the existing snapshot RPC,
setup mappings and unified acceptance runner. The original native-exception
binding (#5232) and unified runner (#5452) are already merged; this patch adds
coverage, not SDK runtime behavior.

Validation uses freshly built and tarball-installed `posthog-node` 5.62.0,
`@posthog/core` 1.63.2 and `@posthog/types` 1.420.0 from that main revision.
Both public CJS/ESM entry points and capture v0/v1 are exercised on Node 24.13.0,
macOS arm64.

- Complete adapter suite: **205 passed / 0 failed or skipped**, including main's
  snapshot tests and **24 real subprocess lifecycle cases**. SDK capture and
  shutdown are not mocked in the lifecycle cases. Command:
  `node --test --test-concurrency=1 compliance/node/v2/*.test.mjs` with
  `POSTHOG_NODE_CONSUMER` selecting the installed consumer.
- Expanded shared exception cases: **12 selected, 10 passed / 2 failed assertions**
  in every configuration against both main and the parked SDK base (`bfd24befe`,
  Node 5.55.0). Runner and saved-report check both exit 1. The failures demonstrate
  object-null serialization and reserved-metadata precedence mismatches.
- Shared execution uses local exception-test additions integrated with harness
  `ffa6cc38dbc4efa64b474d2d81a6c6abad4cd07a` and specs
  `7d6b950d94fddc782df70cca3ec783151f4ee8b9`. All twelve server cases are
  harness-ready. These additions are not yet a released harness/specs combination;
  publishing or enabling them is a separate gate.
- Development wheel and source distribution builds pass. A non-editable wheel
  installed with hash-locked dependencies preserves all 76 feature files and the
  source inventories (158 migration cases; 199 combined acceptance cases).
  Executing its bundled exception cases without a source-spec override reproduces
  **10 passed / 2 failed assertions** in all four configurations on both SDK
  versions. The artifacts record dirty development inputs, not release provenance.

The twelve-case totals are exception-only. Earlier whole-suite, controlled-host
and core-builder totals are historical evidence, not counted here. Docker/container
and hosted CI execution were not performed.

## Capture-exception contract

| Requirement or case                                                | Evidence                                                                                               | Status                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Handled event, native type/message and stack                       | Shared native delivery cases                                                                           | Tested                                                                       |
| Caller scalar/nested properties; properties omitted                | Shared delivery cases                                                                                  | Tested                                                                       |
| Explicit identity and omitted identity                             | Shared explicit-ID cases and Node packaged UUID fallback check                                         | Tested                                                                       |
| Nonstandard thrown values                                          | Shared string, zero, false and object Examples                                                         | Tested                                                                       |
| Entry-first/crash-last frame order; reverse a crash-first stack    | Shared supplied three-frame stack                                                                      | Tested                                                                       |
| Wrapper before root cause                                          | Shared cause list and parent linkage                                                                   | Tested                                                                       |
| Single exception without a cause                                   | Shared native case asserts exactly one list entry                                                      | Tested                                                                       |
| Platforms without a chaining concept                               | Node supports causes; this platform condition is absent                                                | Not applicable                                                               |
| Source context in ascending file order                             | Packaged HTTP test compares context with an actual source file                                         | Tested; Node's default window is 7, not the legacy scenario's 5-line fixture |
| Valid frames without source context                                | Packaged HTTP test uses a missing source file and asserts context fields are absent                    | Tested                                                                       |
| Preserve existing stack rather than synthesize a replacement       | Shared native stack and packaged error-like object stack, including frame functions and line numbers   | Tested                                                                       |
| Drop null-valued custom object properties; retain null array slots | Shared null-properties case                                                                            | **Fail: object nulls remain on the wire**                                    |
| Disabled and opted-out guards                                      | Packaged HTTP tests call capture, flush and public cleanup, then assert no requests                    | Tested                                                                       |
| Suppression of already-captured errors                             | Packaged marked-input case with flush and cleanup                                                      | Tested                                                                       |
| Uninitialized instance API                                         | The adapter cannot call an instance method before public construction                                  | Not an SDK execution case                                                    |
| Coercion failures, exotic values and malformed accessors           | Core builder tests                                                                                     | Component evidence only; not exhaustive public-entry coverage                |
| UUID and flags positional arguments                                | Packaged spies preserve omission/null/falsy values; public HTTP verifies a caller UUID with null flags | UUID delivery tested; native flag-snapshot enrichment remains unassessed     |

The feature separates executable server cases from seven unmigrated `@client`
cases and three conditional platform/source-context `@both` cases. Those ten
cases remain unselected. The Node outcomes are covered by the shared server cases
or the packaged tests above; retained client/platform scenarios are not evidence
of execution. The stack-preservation requirement also has a canonical scenario
that was absent from the legacy feature; the native and error-like stack cases
cover that outcome.

## Exception-event-metadata contract

| Requirement                              | Evidence                                                                                                       | Status                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Canonical exception event envelope       | Shared native, cause and aggregate cases                                                                       | Tested for these inputs; context-free builder cases are component-only                                             |
| Canonical mechanism object               | Shared root and nested mechanism assertions; core metadata tests                                               | Partial; malformed/unknown fields are not exhaustively tested at public entry                                      |
| Capture category and concrete source     | Manual generic category; fatal `onuncaughtexception` category                                                  | **Gap: fatal events omit the concrete capture source**; framework/logger categories remain unassessed here         |
| Explicit handled state                   | Manual true, uncaught false, cause/member linkage                                                              | Tested for these boundaries; broader integrations remain unassessed                                                |
| Explicit synthetic state                 | Native original stack false; generated replacement stack true; raw primitives and plain-object conversion true | Tested; native and plain-object inputs preserve identical supplied frames with different representation provenance |
| Nested relationship source               | Shared causes and aggregate members; core tree/budget tests                                                    | Tested for ordinary trees; cycles and inspection limits are component-only                                         |
| Canonical exception level                | Manual error; real terminating subprocess                                                                      | **Gap: terminating capture emits error, not fatal**; logger severity normalization remains unassessed              |
| Capture-boundary metadata and precedence | Shared reserved caller-property case                                                                           | **Fail: caller properties replace canonical exception data**                                                       |
| Native debug image metadata              | Node JavaScript stack tests                                                                                    | Native symbolication cases not applicable; absence of debug images is not exhaustively asserted                    |
| Custom fingerprint and release inputs    | Existing SDK implementation, not new execution evidence                                                        | Coverage gap                                                                                                       |
| Producer/processor ownership             | Structured summary and nested linkage are inspected before ingestion                                           | Partial; no Cymbal processing is exercised                                                                         |

## Fatal-process behavior

`exception-lifecycle.test.mjs` runs these cases in all four configurations:

1. Autocapture enabled: a real unhandled `TypeError` delivers one event before exit
   code 1. Its runtime stack and unhandled mechanism are checked.
2. Autocapture disabled: Node exits with code 1 without sending an exception event.
3. An application `uncaughtException` listener may continue, explicitly flush, and
   shut down with exit code 0.
4. Strict-mode monitoring exits with code 1 and no observed pre-exit delivery.
5. A 503 receiver or a stalled receiver does not prevent bounded fatal shutdown.
   A fresh process then flushes and closes without replaying the lost event.

These behavioral tests retain the observed `error` severity and missing source as
explicit compatibility observations. They do **not** mark the terminating-boundary
metadata requirement conformant. Fatal severity/source require a separate SDK
correction.

Node uses `PostHogMemoryStorage` and has no next-launch crash reconstruction path.
Failed pre-exit delivery has no durable recovery. This is a **capability gap**, not
a successful next-launch test. The conditional native crash-reporter scenario
cannot be claimed as tested through Node's manual API. Abrupt termination that
cannot execute JavaScript, such as SIGKILL, cannot use the pre-exit flush path.

## Exception steps

The canonical exception-steps applicability explicitly excludes server/multi-tenant
SDKs until request/context-scoped buffers are specified. Therefore all ten
exception-steps requirements (API, wire format, budget, serialization,
normalization, lifetime, isolation, synchronous recording, crash durability and
hybrid forwarding) are **not applicable to the current Node contract**. This does
not establish that Node has crash-durable reporting. No client adapter or native
crash-context persistence is exercised by this suite.

## Remaining gate

The expanded acceptance run remains nonzero. Object nulls on the wire and caller
replacement of canonical exception data are demonstrated SDK mismatches, not
adapter fixes. Fatal severity/source also remain incorrect on current main.
Correcting SDK behavior requires a separately scoped decision.

The expanded harness assertions and specs feature are still local dependencies.
The Node patch preserves main's existing snapshot binding and setup mappings;
its full adapter suite passes with the exception expansion present.
False/zero/null flag-snapshot payload and GeoIP conformance failures belong to their
own acceptance scope and are not included in these exception-only counts.

Fatal metadata, crash durability, integration variants and the partial/component-only
rows remain separate gaps. Do not describe this snapshot as complete exception
conformance.
