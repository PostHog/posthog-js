# `@posthog/browser` bundle architecture

## 1. Purpose

This document defines the bundle architecture for `@posthog/browser`.

The goal is a behavior-complete core in the smallest practical bundle. Core behavior is a fixed constraint. Bundle size is the optimization objective.

The root package must provide a useful capture host. It must preserve required capture admission, consent, identity, session, cross-context, no-throw, and extension-isolation behavior. It owns a bounded in-memory analytics buffer but does not statically import analytics delivery. A separately imported analytics capability supplies Capture V1 batching and transmission eagerly or lazily. Do not reduce bundle size by removing an invariant. Reimplement the invariant with a smaller mechanism or move only the policy that can safely begin after admission.

Optional features must stay outside the root import graph. Each public optional feature must be removable when an application does not import it. Application bundlers must be able to remove each unused module.

These rules apply to source files, package exports, dependencies, build output, and tests. Use the Capture Analytics V1 harness for exact analytics wire behavior.

## 2. Terms

This document uses these terms:

- **Core**: The minimum code for a useful capture client.
- **Root entry point**: The `@posthog/browser` export.
- **Root graph**: All runtime modules that the root entry point imports.
- **Optional feature**: Behavior that is not necessary for basic capture.
- **Import side effect**: Work that starts when JavaScript evaluates a module.
- **Initial chunk**: JavaScript that an application loads before optional dynamic imports.
- **Tree-shakable**: Removable by a bundler when no used export needs the code.

The words **must** and **must not** identify requirements.
The word **should** identifies a strong recommendation.

## 3. Main design rules

1. Preserve required core behavior.
2. Keep the compliant root graph small.
3. Keep every module free of import side effects.
4. Put optional features behind import boundaries.
5. Use explicit exports and exact runtime imports.
6. Preserve ES module boundaries in the published output.
7. Measure bundles from a package consumer.
8. Reject optional code when it enters the root graph.

An API boundary is also a size boundary. A runtime option is not a size boundary.
A minifier cannot correct a bad package boundary. An automatic dynamic import does not make required behavior optional.

## 4. Package layers

Use these layers:

```text
standard preset, optional features, compatibility modules
                          ↓ can import
                   core capture host
                          ↓ can import
               small runtime primitives
                          ↓ can import
                  contracts and types
```

A module can import its own layer or a lower layer.
A module must not import a higher layer.

### 4.1 Contracts and types

This layer defines TypeScript contracts. It must contain no runtime work.

Use `import type` and `export type` for this layer.
A type import must not become a JavaScript import.

Use the shared `Client` and `Extension` contracts from `@posthog/browser-common`.
Do not create a second extension contract.

### 4.2 Small runtime primitives

This layer contains small and general functions. Each function must have one clear purpose.

A primitive must not import a product feature. A primitive must not create a global singleton.
A primitive must not read browser state during module evaluation.

### 4.3 Core capture host

The core must contain all behavior that correct basic capture always needs, and no optional product implementation.

The core contains these responsibilities:

- Consent and privacy enforcement.
- Compact bot filtering.
- Device, anonymous, and identified state.
- Session, window, and cross-context correctness.
- Safe event normalization, copying, and admission.
- Conflict-safe persistence.
- A bounded in-memory analytics buffer that accepts events before delivery attaches.
- Core-generated `$pageview` admission through the same buffer without waiting for remote configuration or analytics delivery.
- A small control-plane Fetch path for immediate remote configuration and extension requests.
- A private core capture lane whose delivery policy can be separately imported.
- Extension lifecycle and isolation.
- No-throw boundaries for customer-controlled and browser operations.

Keep the capture pipeline fixed and direct. Use compact explicit state machines. Do not add a generic middleware framework or a general dependency-injection framework.

Review each core mechanism with compliance tests, bundle measurements, and module attribution. Move optional implementations out of core. Do not move a required invariant out only because it has a measurable cost.

Consent uses `__ph_opt_in_out_<project-token>` by default and accepts a verbatim `consentPersistenceName` override. Store interoperable `0`/`1` values and accept trimmed, case-insensitive `1`/`true`/`yes` and `0`/`false`/`no` forms, including raw boolean and numeric values from compatibility adapters. Keep this logical key independent of identity persistence and consistent across consent storage adapters. Resolve denial before identity state, persistence, extension setup, or requests. Re-read consent at every host gate and persistence boundary. Default local storage uses native `storage` events plus a same-document SDK event; adapters can provide an optional keyed subscription for prompt external revocation. All listeners start during client initialization and stop during disposal. Deprecated prefix-derived keys and migration between storage backends belong in a compatibility entry point.

Create session and window IDs lazily on the first successfully admitted capture. Preview session context while finalizing an event, but do not expose, persist, or install tab lifecycle state until bounded admission succeeds; rejected work must not create, rotate, or advance session state. Match `posthog-js` analytics semantics by rotating both IDs after reset, idle timeout, or maximum session length, and by adopting a sibling tab's active session while retaining the receiving tab's current window ID. Persist monotonic session revisions and explicit reset tombstones so sequential stale identity, group, or extension-data writes preserve the newest session authority; revalidate authority around admission commit, and discard stale finalized work rather than overwrite a newer session or reset. Missing or malformed optional session data is not a reset. With default storage, preserve ordinary reload windows and separate copied tab storage through tab-scoped storage; lifecycle cleanup and a no-throw navigation-type fallback cover browser reload differences. Core must not run a background timer solely to rotate sessions. Replay owns proactive recorder shutdown, interaction state, snapshot buffering, and recording-age limits; session rotation or notification alone must not start or flush a product. The alpha still documents perfectly simultaneous equal-revision whole-record writers after the final authoritative read as last-writer-wins.

The analytics delivery capability must use Capture Analytics V1 at `POST /i/v1/analytics/events`. It must not use the legacy `/e/` envelope. Normal analytics delivery must use Fetch so it can send required headers, observe the UUID-keyed result map, time out, rate limit, and retry only server-marked retry events. It receives the core's bound Fetch capability but owns analytics-specific batching, authentication, compression, response, retry, and teardown policy. Remote configuration uses the small core control-plane request path and must not wait for analytics delivery to load.

A lane has a stable typed sink and bounded queue plus an attachable delivery policy. The core analytics lane retains at most 1,000 queued events and 8 MiB across active and queued UTF-8 serialized finalized messages. An individual finalized core message has the same 8 MiB local limit. Queue pressure evicts the oldest queued prefix when enough queued work is reclaimable; active work cannot be recalled, so active bytes can reject a new event without evicting valid queued work. Queue residence expires strictly after one hour at the next admission, installation, drain, flush, or retry handoff; expiry uses monotonic local admission time and starts no timer. These package-private values bound browser memory and stale delivery and do not claim the deployed V1 event or batch limits. The policy owns one endpoint, event/batch serializer, server payload limits, compression, transport, response classification, retry policy, and teardown policy. Events with different policies must not share a batch. A failure in one lane must not requeue or resend events accepted in another lane. The composition root creates the first generic lane and privately gives its sink to general `capture()` before delivery attaches. No coordinator exposes a named analytics lane or understands endpoints. The root statically includes only that lane, admission, and bounded buffer, not the analytics delivery policy. Attaching a policy must preserve queued event UUIDs, timestamps, identity, session, ordering, consent decisions, measured bytes, admission time, and retry multiplicity. Optional product entry points create their lanes only when imported; the root must not contain their implementations or a product catalog.

After configured extensions install, core admits one enabled initial `$pageview` through ordinary capture before the factory resolves. `capturePageview: false` disables it. Explicit denial and bot filtering prevent document access; hidden documents wait on one disposable visibility listener, and a later explicit opt-in can admit a pageview that prior denial held pending. The core event has no title, URL, referrer, page-view identifier, history patching, or page-leave behavior; those remain in an optional page-view/browser-context product.

Select an optional lane through an explicit product API, such as `captureAi()`, not an event-name prefix or a caller-supplied lane string on general `capture()`. General `capture()` always uses analytics. The product module receives only its private lane sink. Install the lane lazily, then include it in client `flush()` and `dispose()`. Lane sinks, lane state, delivery policies, and the coordinator are package-private implementation details; do not export them from the package root or add them to the shared `Client` contract. This follows Python's `_capture_ai` lane and the unmerged Node `captureAi` design while keeping product code removable from the browser root.

Teardown delivery must use the Capture V1 header-less Beacon contract only after the target backend and proxy paths support it. Otherwise, use Fetch with `keepalive: true` and the normal V1 headers. Treat a successful Beacon call as browser acceptance, not confirmed delivery. Enforce one aggregate teardown-byte budget across all Beacon and keepalive Fetch attempts; splitting a batch does not increase the browser's shared in-flight quota. Do not parse per-event responses, start asynchronous compression, or start retry timers during teardown. Register page lifecycle listeners during client initialization and remove them during disposal.

### 4.4 Optional adapters and extensions

Put delivery or product behavior in an extension, capability, or adapter. Examples include analytics delivery, replay, surveys, and web vitals. Analytics delivery installs on the private core capture lane through the same internal mechanism used by optional lanes; it is not registered in a public product catalog.

An optional module can import the core. The core must not import the optional module.

Each optional module must have an explicit entry point. A consumer must import that entry point directly.

### 4.5 Standard preset

A standard preset can select recommended features. The root entry point must not import the standard preset.

The preset must keep large features behind dynamic imports. Each large feature must create a separate chunk.

Measure the preset in two ways:

- Initial size.
- Total size after all dynamic imports.

### 4.6 Compatibility and migration modules

Put old-browser support, full historical-state migrations, and heavy fallbacks in separate entry points.

The root graph must not contain these modules. Importing the root must not run a general migration.

A supported upgrade path must still recognize a prior explicit denial before the first analytics persistence write or request. This narrow privacy compatibility rule is part of consent enforcement, not an optional historical-state migration.

Cross-context conflict safety is also a core invariant. Same-origin local-storage persistence must prevent stale writers. A selected cross-subdomain cookie adapter must provide equivalent reconciliation for shared cookie state.

## 5. Root entry point

The root entry point must provide a useful capture host with bounded analytics admission. It must not statically include analytics transmission or every PostHog product. A standard preset can attach analytics delivery eagerly or start a literal dynamic import immediately while core remote configuration proceeds in parallel.

The root entry point must use named exports. It must not create a default client singleton.

Use this form:

```ts
export { createPostHog } from './posthog'
export { version } from './version'
export type { PostHog, PostHogOptions } from './types'
```

Do not use this form:

```ts
export * from './products'
export { default } from './singleton'
```

The root entry point must not re-export optional runtime features.
You can re-export types when the compiler produces no JavaScript import.

Treat `createPostHog` and its static imports as one size unit.
A bundler cannot remove an internal module when the factory always needs that module.

Do not implement a large optional feature as a method on the core client class.
Bundlers usually retain all methods on a used class.
Use an extension or an adapter instead.

## 6. Import graph rules

### 6.1 Use exact runtime imports

Import the exact runtime module that the code needs.

Use this form:

```ts
import { Publisher } from '@posthog/browser-common/pubsub'
import type { Client, Extension } from '@posthog/browser-common'
```

Do not use a runtime root barrel when an exact subpath exists.
Do not use a utility barrel for runtime imports.

### 6.2 Keep barrels narrow

A barrel can export types. A runtime barrel must use explicit named exports.

Do not use `export *` across product boundaries.
Do not use `export *` across side-effect boundaries.

A root barrel must not import a module only to register it.

### 6.3 Prevent cycles

Keep the import graph acyclic. A cycle can prevent tree shaking and can change initialization order.

Move shared contracts to a lower layer when two modules need each other.
Do not fix a cycle with a runtime service locator.

### 6.4 Do not use internal deep imports

Publish each supported entry point in the `exports` map.
Do not require consumers to import a file from `dist`.

Internal emitted files are not public entry points.

## 7. Import purity

The package declares `sideEffects: false`. Every published entry point must satisfy that declaration.

Module evaluation must not do these operations:

- Read or write storage.
- Read the DOM.
- Add an event listener.
- Start a timer.
- Start a network request.
- Create a client.
- Register an extension.
- Modify a global object.
- Install a polyfill.
- Emit telemetry.

Start work only from a factory, a method, or `Extension.setup()`.

Use a function to read a browser capability:

```ts
const getDefaultFetch = () => globalThis.fetch?.bind(globalThis)
```

Do not capture a browser capability at module scope:

```ts
const defaultFetch = globalThis.fetch?.bind(globalThis)
```

A module can define constants and pure functions at module scope.
A module can create immutable data when that data has no external effect.
Keep large data tables outside core when basic capture does not need them.

If an import side effect is unavoidable, prefer a separate package. Otherwise, create an explicit side-effect entry point and change `package.json#sideEffects` from `false` to an array that lists only that entry. Do not set the whole package to `sideEffects: true`.

## 8. Optional feature rules

### 8.1 Use an import boundary

Use a separate export subpath for each substantial optional feature.

Example:

```text
@posthog/browser
@posthog/browser/standard
@posthog/browser/delivery/analytics
@posthog/browser/persistence/cookie
@posthog/browser/delivery/durable
@posthog/browser/extensions/feature-flags
```

Add the source entry and the package export in the same change.
Add a consumer bundle test for each public runtime entry.

### 8.2 Do not use configuration as a bundle boundary

A boolean option changes runtime behavior. It usually does not remove imported code.

Do not use this pattern for a large feature:

```ts
import { largeFeature } from './large-feature'

if (options.enableLargeFeature) {
    largeFeature()
}
```

Use an explicit import or an extension:

```ts
import { largeFeature } from '@posthog/browser/extensions/large-feature'

await posthog.installExtension(largeFeature())
```

A small branch can stay in core when a separate boundary adds more bytes.
The change must include measurements that support this decision.

### 8.3 Keep the registry empty

The extension registry must store only supplied instances and supplied loaders.

Do not add a static catalog of product implementations to the core.
Do not auto-register all known extensions.

Do not put this code in the root graph:

```ts
import { replay } from './replay'
import { surveys } from './surveys'

const products = { replay, surveys }
```

A product-name catalog can exist in a separate preset entry point.

### 8.4 Use real dynamic imports

`loadExtension()` does not create a chunk by itself. The loader must contain a dynamic `import()`.

Use this form:

```ts
await posthog.loadExtension(async () => {
    const module = await import('@posthog/browser/extensions/feature-flags')
    return module.featureFlags()
})
```

Use a literal module path. This lets the bundler create a stable chunk.

Do not pass a statically imported extension to `loadExtension()` and expect code splitting.
Do not use a computed import path for a known product list.

## 9. Extension design

An extension must be a factory result or an application-supplied instance.
It must not be a shared mutable singleton.

An extension must start external work only in `setup()`.
An extension must release owned resources in `dispose()`.
Cleanup must be safe after partial setup.
Cleanup must be safe when code calls it more than once.

The host must give each extension a narrow `Client` view.
The view must expose capabilities, not the concrete host implementation.

The host must keep extension state separate. The host must dispose extensions in reverse installation order.

An extension failure must not stop core capture. A failed setup must remove all reserved registry state.

## 10. Dependency rules

The root graph must not import these packages:

- `posthog-js`.
- `@posthog/core`.
- `core-js`.
- `fflate`.
- Preact.
- DOMPurify.
- rrweb.
- `web-vitals`.

Put a heavy dependency behind an optional entry point. Prefer a browser capability before a JavaScript fallback.

Do not install a global polyfill from the root graph.
Use a local capability check and a local fallback when the fallback is small.

Check the `sideEffects` field of each runtime dependency.
Import a side-effect-free subpath when the dependency provides one.

Move code to `@posthog/browser-common` only when more than one SDK uses the code.
Shared location does not make code free. Measure the resulting consumer graph.

## 11. Build and package rules

Publish unbundled ES modules. Preserve the source module boundaries.

Also publish CommonJS only when a supported consumer needs it.
Modern bundlers must resolve the ES module output through the `import` condition.

Use modern JavaScript as the library target. Let the application bundler select older targets.
Do not add compatibility transforms to the root without browser-support evidence.

Keep an exact `exports` map. Do not expose all files with a wildcard export.

Keep `sideEffects: false` while all entry points remain import-pure. If an explicit side-effect entry becomes necessary, use a small array allowlist instead of `false`.

Do not combine all entry points into one prebuilt runtime bundle.
The package needs preserved ES module boundaries for consumer tree shaking.

## 12. Bundle tests

Measure code as a package consumer. Build the package before each measurement.
Do not use source-file size as a bundle metric.
Do not use npm unpacked size as a browser bundle metric.

Run the current core check from `packages/browser-next`:

```sh
pnpm bundle-size
```

The previous 12 KiB gzip threshold is not a binding budget. Set the release ceiling only after the core behavior suite passes and the compliant graph is optimized. This policy is not permission to omit required behavior.

After the first behavior-compliant baseline, set binding regression budgets from the optimized consumer bundle. If required behavior exceeds the working budget, inspect and simplify the implementation. Do not delete the invariant.

The current check reports these values for the core capture fixture:

- Minified bytes.
- Gzip bytes.
- Brotli bytes.

The current check also reads an esbuild metafile. It rejects known heavy modules in the root graph and prints minified-byte attribution. Pass `--analyze` for the full esbuild import-path report. It does not store a baseline.

Add these fixtures when the related public entry points exist:

| Fixture                 | Required check                                        |
| ----------------------- | ----------------------------------------------------- |
| Root export only        | An unused root export does not retain unrelated code. |
| Type-only consumer      | Type imports produce no JavaScript.                   |
| Optional static import  | Only the selected optional feature enters the graph.  |
| Optional dynamic import | The feature stays outside the initial chunk.          |
| Standard preset         | Initial and total sizes stay separate.                |
| Server import           | Package import does not require browser globals.      |

Each optional-feature check must report these values:

- Initial chunk bytes.
- Dynamic chunk bytes.
- Total loaded bytes.
- Module attribution.

Extend the bundle-size script when you add a new public entry point.
Fail the check when a forbidden product or dependency enters the root graph.

Add a stored baseline before the first public release. Review each later increase against that baseline.
An increase needs a user benefit and a short size explanation.

## 13. Review procedure

Use this procedure for each runtime change:

1. Identify the durable behavior test, explicit decision, or Capture V1 compliance case.
2. Add or identify the parity, conformance, or fault-injection test that protects it.
3. Identify the new static imports.
4. Check the direction of each import.
5. Convert contract imports to `import type`.
6. Check all changed modules for import side effects.
7. Add an export only when a public import boundary is necessary.
8. Add or update a consumer fixture.
9. Run `pnpm bundle-size`.
10. Inspect module attribution when the runtime graph changes.
11. Report the behavioral decision and size change in the pull request.

Ask these questions during review:

- Does basic capture always need this code?
- Can an application omit this feature by omitting one import?
- Does a runtime option hide code that needs an import boundary?
- Does the root import an optional implementation?
- Does a barrel make the runtime graph unclear?
- Does module evaluation start work?
- Does the dynamic loader create a separate chunk?
- Does the package export match the intended public boundary?
- Do bundle tests prove the result?

If an answer is not clear, do not add the code to the root graph.

## 14. Decision priority

Use this priority when two designs have similar behavior:

1. Select the smaller root graph.
2. Select the design with the clearer import boundary.
3. Select the design with fewer import side effects.
4. Select the design with fewer framework abstractions.
5. Select the design that produces stable dynamic chunks.
6. Select the design that is easier to measure.

Do not trade correctness, privacy, or no-throw behavior for a smaller bundle.
Use bundle size as an architectural constraint, not as the only constraint.
