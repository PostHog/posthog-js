# Explicit select selection masking: local implementation

Follow-up work on top of PR #5670 at `2fbf77102`, in `/Users/marandaneto/Github/posthog-js-custom-multiselect-privacy`. Nothing has been committed, pushed, deployed or changed in the original PR worktree by this follow-up. PR #5670 is now merged. Its former worktree path was absent at closeout; this session did not remove it.

## Proposed API

```ts
posthog.init('<project-token>', {
    session_recording: {
        maskAllInputs: true,
        selectMaskingFn: (select) => (select.matches('[data-replay-public]') ? 'unmasked' : 'masked'),
        maskInputFn: (text) => '*'.repeat(text.length),
    },
})
```

```ts
type SelectMaskingFn = (element: HTMLSelectElement) => 'masked' | 'unmasked'
```

The callback receives the owning select, including for options nested in optgroups. It must be pure. It can run more than once during serialization; call counts are not an API guarantee.

It is re-evaluated for input events, mutations within the select subtree, and snapshots. Its result can change between captures. Changing unrelated external state alone is not an event source; that change takes effect at the next relevant capture.

## Interaction with maskInputFn

- `selectMaskingFn` authorizes or suppresses selection identity metadata.
- `maskInputFn` supplies replacement text for masked inputs.
- **Returning original text from maskInputFn still records that text, even when selectMaskingFn returns 'masked'.** The text callback remains responsible for sanitizing its own output. This warning is in the public SDK declaration, the recorder type mirror and the rrweb callback declaration.
- Explicitly unmasked selects bypass maskInputFn. Other input types are unaffected.
- Customers need both only if they want custom replacement text. Without maskInputFn, masked selects use default asterisk replacement.

## Option absent

Legacy behavior remains unchanged, including documented maskInputFn passthrough and the pre-existing custom-multiselect attribute gap. There is no inference from callback presence or output equality.

The original nine legacy privacy reproductions are retained byte-for-byte in `investigations/select-masking-policy/legacy-privacy.repro.txt`. They still demonstrate the leak for unchanged, non-opted-in configurations. The normal compatibility suite asserts the approved legacy wire format and retains nine opt-in privacy regressions for the same direct/grouped/duplicate and selected/defaultSelected/removal cases. No CI discovery exclusion or global skip hides the archive. This additive API cannot automatically fix legacy configurations while preserving their existing behavior.

## Explicitly masked

- Overrides category-level select unmasking.
- Uses maskInputFn or the default masker for replacement text.
- Omits selected flags from option snapshots and suppresses raw selected-attribute mutations.
- Processes selection changes through the existing input pipeline without original selected option IDs.
- Clears replay selection even if replacement text matches a real option value.
- Invalid results and callback exceptions resolve to masked, including after the select was previously public.
- This masks selection state, not static option labels or values. Block the subtree or apply text masking if the choices themselves are sensitive.

## Explicitly unmasked

- Overrides category-level select masking.
- Preserves initial selected flags.
- Routes selected-attribute changes through the input pipeline using the existing selectedOptionIds field.
- Preserves multiple selections, duplicate-valued option identity, removals and explicit empty selections.
- Does not override subtree blocking. Existing input-ignore, mirror validity, batching and teardown remain in the shared input path.

## Migration

1. Upgrade the core SDK and lazy recorder together, and consume a matching player before relying on transitions. An unsupported recorder stops recording only when the option is configured; an old core cannot enforce this new contract.
2. Keep `maskAllInputs: true` for other fields. Default `selectMaskingFn` to `'masked'`, explicitly permitting only approved public controls. This explicit policy can override select masking even when `maskAllInputs` is true.
3. Keep a sanitizing `maskInputFn` only if custom replacement text is needed. Returning raw text is not safe merely because the selection policy says masked.
4. If policy depends on permission state, represent changes in the select subtree, for example `select.toggleAttribute('data-replay-public', permitted)`. A closure variable changing alone does not schedule capture.
5. Omitting the option retains legacy behavior. Neither an identity text callback nor `ignoreSelector` is a substitute for an explicit masking policy.

## Dynamic transitions

The stable-policy restriction from the initial draft has been removed. Both transition directions work locally for single/multiple selects, native input, policy-only attribute changes, frozen delivery, option-list additions/removals, callback errors, iframe/shadow-root recording, play, real seek, virtual seek and backward seeking.

The implementation reuses the existing `rr_maskedSelect` snapshot attribute:

- `true`: a masked selection.
- `null`: an explicitly unmasked selection. Null is already supported by the serialized attribute type and is inert in existing rebuild logic.
- Attribute absent: retain legacy scalar callback behavior.

For tagged selects, later input events update the live mirror marker. An existing option-ID array, including `[]`, means explicitly unmasked; an event without option IDs means masked. Untagged legacy callback recordings are not reinterpreted. No original option IDs are emitted for masked selections, no new wire field is added, and transitions do not force whole-page snapshots.

Mirror metadata updates copy the attributes object rather than mutate the recorded full snapshot. This prevents backward seeks from starting with a policy changed by earlier playback. Repeated policy-only writes are coalesced by the existing select set: a 100-write test observes one selected-set scan, one input and only the initial full snapshot.

This is an intentional extension of how the existing marker is interpreted. A matching player build is required for dynamic transitions; having no new field does not mean an older player automatically supports the new behavior.

## Mixed core/recorder versions

The recorder advertises `record.supportsSelectMasking = true`, including in the built `@posthog/rrweb-record` entrypoint. Both lazy entrypoints also advertise `initSessionRecording.supportsSelectMasking = true`. The core loader checks both capabilities before constructing a driver when the policy is configured. A missing/false capability prevents recording instead of entering an older driver that can discard the option. The lazy driver independently checks the rrweb capability. Configurations without the option continue to work with older recorders.

Real distribution tests found two gaps in the first guard: an old extension bypassed its new internal check, and a current rrweb paired with an old initializer advertised only half the support. Both produced a raw selected-attribute mutation before the core guard was fixed. The built core now rejects both before any replay event is captured.

Adding, replacing or removing the callback through `set_config` restarts an active supporting recorder and discards queued old-policy data. The core retains the installed callback reference; an unchanged callback does not restart on remote-config refresh. Keep the reference stable and change its result via permission/DOM state for normal transitions. Those result changes remain capture-driven and do not force full snapshots.

An older SDK can still discard an unknown option from its allowlist. Using this API therefore requires an SDK version that forwards it; upgrading the recorder alone cannot activate a policy an old core did not forward. This cannot be retroactively repaired inside already deployed SDK cores.

## Source map

- Canonical public SDK declaration/warning: `packages/types/src/posthog-config.ts`, `SessionRecordingOptions.selectMaskingFn`.
- Browser recorder types/capability: `packages/browser/src/extensions/replay/types/rrweb.ts`.
- SDK forwarding/direct-driver guard: `packages/browser/src/extensions/replay/external/lazy-loaded-session-recorder.ts`.
- Core pre-construction guard and callback replacement: `packages/browser/src/extensions/replay/session-recording.ts`.
- Driver capability advertisement/type: `packages/browser/src/entrypoints/{posthog-recorder,lazy-recorder}.ts` and `packages/browser/src/utils/globals.ts`.
- Shared resolution/live metadata copying: `packages/rrweb/rrweb-snapshot/src/utils.ts`.
- rrweb callback type/warning: `packages/rrweb/rrweb-snapshot/src/types.ts`.
- Snapshot marker/selected flags: `packages/rrweb/rrweb-snapshot/src/snapshot.ts`.
- Subtree mutation batching: `packages/rrweb/rrweb/src/record/mutation.ts`.
- Input masking/IDs and recorder mirror state: `packages/rrweb/rrweb/src/record/observer.ts`.
- Replay synchronization: `packages/rrweb/rrweb/src/replay/index.ts`.
- Capability advertisement and optional configuration plumbing: `packages/rrweb/rrweb/src/record/index.ts` and `src/types.ts`.

## Regression evidence

- Initial opt-in implementation: 14 red behaviors / eight controls before the option existed.
- Dynamic transitions: 12 valid failures across both directions and play/real/virtual seek, plus six passing checkout controls, before synchronization.
- Mixed-version guard: two real behavior failures before the guard, with supported-recorder forwarding passing.
- Capability assertion: failed before the property was advertised.
- Current focused API/dynamic/scope suites: **89 pass** (29 API, 52 transitions/lifecycle, eight same-origin iframe/shadow cases).
- Original leak opt-in variants, callback-text warning behavior and updated marker protocol probes: **12 pass** in a focused run.
- Snapshot metadata-copy units: **three pass**. Initial snapshot data remains unchanged across record/playback/backward-seek tests. Replay's expected event-level timer delay bookkeeping is not treated as snapshot-data mutation.
- Complete SDK replay directory: **1,078 pass across 20 files**, including 431 lazy-recorder tests and 59 core remote-config tests. Eight new core behaviors had valid pre-fix failures; positive forwarding and unchanged-callback controls passed.
- **Ten actual-distribution Brave cases pass:** old extension rejected with the policy, old extension retained without it, current masked/unmasked forwarding, disabled recorder capability, delayed remote config, current/old extensions with persisted config before fresh config arrives, runtime policy activation, and current rrweb paired with an unsupported initializer. Published old asset: `https://us-assets.i.posthog.com/static/1.447.14/posthog-recorder.js`. Runtime activation also reproduced a raw selected-attribute mutation before callback-aware restarting.
- Snapshot/rebuild/utilities/cost and metadata-copy suites: **282 pass / one existing skip**.
- Build/type gates, actual built recorder/driver capabilities, scoped lint, repository formatting and whitespace checks pass. All **four canonical types-package tests** pass, including native/legacy declaration-build parity.
- Fast esbuild array.js comparison against `origin/main` at `c913d67a`: **+0.27% minified** (+1.13 KiB), **+0.18% gzip** (+0.24 KiB), **+0.19% Brotli** (+0.20 KiB), 1.16 seconds. This is directional, not a production Rollup size claim.

The old investigation's synthetic probe originally demonstrated that the initial marker overrode later IDs. Its expectation was deliberately updated to the new behavior that allows dynamic unmasking. The nine original no-policy leak assertions are unchanged.

The archived investigation was run separately and confirmed **nine legacy failures / 21 passing opt-in and control cases**. Its original failure assertions are unchanged. Normal CI uses the explicit legacy-wire characterizations instead. Disabling the policy option in the CI fixture makes **all nine retained opt-in regressions fail**; the option was restored after that controlled mutation.

The fresh broad rrweb run passes **1,245 tests across all 93 files**, with five skips: two previously reproduced Brave virtual-stylesheet exclusions and three existing skips. It needs no legacy/privacy name exclusion. One probe that asserted only fixture callback equality was removed from CI; the policy suite still checks the actual recorder/player text-collision behavior. The dedicated test profile pins light color scheme to match the existing visual baselines; ambient dark mode independently reproduces five visual failures. No test discovery configuration, repository harness, baseline or visual threshold changed.

```sh
# packages/rrweb/rrweb, using the dedicated Brave Puppeteer launcher
pnpm retest --maxWorkers=1 --minWorkers=1 \
  -t '^(?!.*StyleSheetRule (changes|deletion) on virtual elements)'
```

## Local testing continuation

Six additional timeline cases cover single/multiple selects across playback, real seeking and virtual seeking, with repeated backward/forward scrubbing. Seven checkpoints include empty selections, frozen option insertion, checkout and a throwing policy despite an otherwise-public DOM predicate. Snapshot data stays unchanged, and policy-result transitions still need only the initial snapshot and explicit checkout. A controlled older-reader substitution fails all six cases.

Seven additional core cases cover callback replacement in both directions, replacement with the same current decision, stop/restart without a redundant refresh restart, and a paired buffered-data control. A normal stop sends the authorized queued selection; policy replacement discards it. Substituting `stop()` for `discard()` makes the privacy case fail with the original option ID, while its normal-stop control passes. Disabling callback-change detection fails all six replacement cases. All controlled production mutations were restored byte-for-byte. Submission validation added a case for enabling the policy on an already-running unsupported recorder. It reproduced a queued public input being flushed on stop. That path now discards old producer data instead, matching supported policy replacement.

Two actual-distribution local Brave cases exercise compressed and uncompressed transport, callback replacement, callback failure/removal, stop/restart and repeated real/virtual scrubbing. The compressed case uses native gzip with a test-only stream delay; counter deltas prove compression is pending at replacement. Each local receiver's snapshot event stream matches the SDK capture copies: 53 rrweb events, nine snapshots and no stale public selection IDs after replacement. The nine snapshots are three startup snapshots plus six required configuration/restart snapshots; an unchanged callback adds none. No external request or page error occurs. Saved exact-payload replay also still passes 66 policy and 66 legacy assertions.

The local-only continuation did not change production code. The later unsupported-recorder correction above was made during submission validation. All capture/receiver work in the local continuation is local, using a synthetic token. No new cloud upload, deployment, commit or push was made.

## Incident-risk review

- **Lazy boundary/start conditions:** absence of the new option remains neutral. No new core method consumed by an extension or persisted-state field is required. Only an explicitly configured policy requires both recorder and driver capabilities, deliberately failing closed if missing/false. Ten native distribution cases cover the real lazy boundary, persisted config and delayed config. The broader packed historical-core matrix has 98 functional passes; its strict stock-browser golden gate remains outstanding as detailed below.
- **Serialization/replay:** native browser assertions cover actual duplicate selections, both transition directions and backward seeks. Mirror updates copy snapshot attributes; the original snapshot data stays unchanged. No recorded HTML/URL is introduced into the viewer origin, and the sandbox is unchanged.
- **Privacy:** the opt-in tests assert no selected attributes/original option IDs on private paths. Original-text callback output remains caller-controlled and is explicitly documented/tested. The legacy no-policy gap is preserved rather than mislabeled fixed.
- **Volume:** changes to an installed policy's result do not trigger extra full snapshots or add timers. Batching/dedup remain bounded. Replacing the configured callback does restart recording, so keep its reference stable rather than recreate it on each render. Policy-derived input events can affect activity classification/payload volume for opted-in sites; watch the recordings week-over-week anomaly alert for a day after release.

## US-cloud validation

Post-review run `select-policy-us-2026-11-12T15-47-52-933Z`, project 72775. Sender SDK SHA-256: `67f048ea27fe1d6affb2dd8057a0849e092f5453b29474e3d1c1870f385dfac9`.

- Authenticated MCP confirms all **22 checkpoint events**, eleven per session, recorded as propertyless events.
- Policy session `01a1d071-b34a-7182-b346-96415dd2ad34`: **215 replay events**, 40 seconds, zero recorded console errors.
- Legacy control `01a1d072-74a3-7446-8d29-f3f64ec6fe01`: **201 replay events**, 41 seconds, zero recorded console errors.
- Each final stream has five full snapshots, including a baseline before the first checkpoint. Startup overrides and an explicit checkout account for the snapshots; policy transitions do not request them.
- Exact submitted payloads match the SDK capture copies. Local matching-player checks pass **66 policy assertions** across sequential play, real seek and virtual seek. Another **66 legacy assertions** match the published 1.447.14 player. The earlier run also matched the pre-feature player from the unchanged #5670 worktree.
- **28 wire-privacy checks** verify policy markers, omitted private selection flags/IDs and explicit public ID arrays, including empty selections. Input authorization is compared to independently captured native fixture phases: frozen input can precede the generic data-attribute mutation on the wire, so serialized attribute arrival order is not the policy oracle.
- Blocked-option and unrelated-input sentinels are absent from submitted payloads. MCP confirms stored event/recording metadata and counts, not the raw snapshot bodies; the payload privacy assertions are local pre-upload evidence.
- Earlier attempts are not playback proof for their initial checkpoints: a fixture capture hook incorrectly used `structuredClone` on callback-bearing diagnostics, throwing and dropping the initial batch. The final fixture copies the JSON wire form and does not patch SDK/recorder methods.
- The published `https://us-assets.i.posthog.com/static/1.447.14/rrweb.js` player fails **21 of the 66 policy assertions**, seven in each replay mode, against these exact submitted payloads. Public selections can remain blank and a masked single select can show the first duplicate-valued choice. This is a published-component compatibility failure, not proof of which player build the cloud UI currently consumes.
- An automated cloud vision observation reported matching policy frames, but its legacy-control narrative contradicted the captured payload behavior and fixture. It is not accepted as release proof. Actual deployed-player correctness remains unverified; no additional scans or ratings were used to force a green result.
- No deployment, project-settings change or recording deletion was made. Capture credentials and full payload artifacts remain outside the repository.

## Historical deployment compatibility

The actual production-packed harness ran with Brave 157, verified through its CDP command line and executable hash, using dedicated temporary profiles. It covered all seven supported current/historical deployments, pinned historical cores 1.354.0 and 1.407.6, seven replay scenarios and two repetitions: **98/98 functional runs passed**. Asset/source input integrity checks passed.

The strict gate is **not green**. All seven network-replay cells differ across repetitions in volatile browser `navigationId`, with `confidence.value` also varying for slim deployments. A separate run of the six other replay scenarios passes all 84 functional runs and all 42 repetition comparisons. Its saved-golden comparison has 2,364 differences, exclusively `$browser`, `$browser_version`, `$screen_height` and `$screen_width`: the goldens describe stock Chrome 136 at 1024x768, while this run uses Brave at 1280x800. There are no other golden differences in that run.

No golden, normalizer or compatibility-harness source was changed to hide those differences. This is Brave-only validation, not the full stock Chromium/Firefox/WebKit release gate. Artifacts are outside the repository under `/tmp/posthog-select-policy-compat.rVKk4Z`.

## Future rollout considerations

These are prerequisites for a later rollout, not blockers to continued local testing with matching recorder/player builds. No release or deployment is currently requested.

The patch changeset covers `posthog-js` and the canonical public `@posthog/types` declaration. No rrweb package changeset is added.

- Coordinate the already-approved API's public documentation/spec publication with rollout.
- Run the full stock three-engine historical compatibility release gate. Brave runtime coverage is complete for the selected replay matrix, but the strict golden gate is not green.
- Publish/consume a matching player and verify actual deployed replay. Ingestion is MCP-confirmed; published 1.447.14 is incompatible, and the cloud AI narrative is not a substitute for corroborated playback.
- Final review is complete with **no blocking findings**. It reviewed an immutable copy of the full final tree against `merge-base(origin/main, HEAD)`, including parent #5670 changes and untracked follow-up files, without creating implementation commits. Explicit `origin/main`: `c913d67a5472e4926c9bd2f4aefda33105e97ac4`; merge base: `60aab39361dc9cfabbe9bbbc14261f7f31795a7d`. The original frozen source hashes stayed unchanged during review. That review predates the unsupported-active-recorder discard fix and the submission merge. Submission uses a fresh review of the final committed branch. This implementation is local and not a merged/released fix.

Historical investigation and strict-suppression tradeoffs remain in `CUSTOM_MULTISELECT_PRIVACY_INVESTIGATION.md`.
