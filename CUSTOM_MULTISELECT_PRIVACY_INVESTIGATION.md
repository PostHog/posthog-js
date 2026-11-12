# Custom multiselect selection privacy investigation

> Historical investigation recorded before the opt-in API draft. The current worktree now contains uncommitted implementation changes; see `SELECT_MASKING_POLICY_DRAFT.md` for the current state. The findings and original failing legacy reproductions below are retained unchanged.

## Starting point and scope

- Fresh worktree: `/Users/marandaneto/Github/posthog-js-custom-multiselect-privacy`.
- Branch: `investigate/custom-multiselect-privacy`.
- Exact base: PR #5670 at `2fbf77102f5a5c4405561747801161f7a2d41eb3`.
- Original PR/worktree were not modified. No commit, push, API, changeset or deployment was made.
- Production files are restored byte-for-byte to the starting commit. Only this report and an investigative browser test are untracked.

The question is how to close the deliberately deferred custom-multiselect choice-identity gap without pretending that a string-returning callback communicates permission to reveal option identity.

## Conclusion

There is no automatic, fully backward-compatible way to distinguish every existing passthrough callback from a redactor using its string output. A real fix needs an explicit privacy/migration decision, not a better heuristic.

The smallest privacy-first code change is to remove the custom-multiselect exception and route all category-masked selected-attribute mutations through the sanitized input path. This fixes the reproduced leak but breaks existing passthrough configurations. Existing explicit category unmasking already preserves full selections and duplicate-valued option identity. Per-element opt-outs need a separately agreed explicit policy API if users must retain visible, selectively unmasked controls without blocking the sensitive controls entirely.

An additive opt-in policy could provide a safe migration path, but it does NOT close the gap for unchanged legacy configurations. Closing it for all existing clients necessarily changes the ambiguous legacy behavior.

## Reproduction and experiments

Commands run with Node 24.21.0, pnpm 11.7.0 and the dedicated Brave Puppeteer launcher:

```sh
export PATH=/Users/marandaneto/.nvm/versions/node/v24.21.0/bin:$PATH
export PUPPETEER_EXECUTABLE_PATH=/tmp/posthog-5618-brave-local-network.sh
export PUPPETEER_HEADLESS=true
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@posthog/rrweb
cd packages/rrweb/rrweb
pnpm retest \
  test/record/custom-multiselect-privacy-investigation.browser.test.ts \
  test/record/selected-attribute-multiple.browser.test.ts \
  --maxWorkers=1 --minWorkers=1
```

The retained investigation has 20 cases: nine desired-privacy regressions and eleven passing characterization/control cases. Together with the existing 17-case compatibility suite, the restored PR head has **nine failures and 28 passing cases**. These nine failures are intentional, honest reproductions, not merge-ready tests.

### 1. Current PR: nine privacy failures

For direct, grouped and duplicate-valued multiselects, each of `setAttribute('selected', '')`, `defaultSelected = true`, and `removeAttribute('selected')` emits original option identity despite `maskAllInputs: true` and a constant-redacting callback. The initial snapshot does not retain the selected flags, but later mutations carry the option ID and selected/null attribute without invoking the callback on that path.

Failing assertion: `selectedMutations` should be `[]`, but contains `{ id: optionId, attributes: { selected: '' } }` or `{ selected: null }`.

Logs:

- `/tmp/posthog-multiselect-gap-baseline-final.log`: nine failures / 26 passing cases before adding the two protocol probes.
- `/tmp/posthog-multiselect-gap-restored-final.log`: nine failures / 28 passing cases after restoring production sources and adding both probes.

An initial blocking-control assertion incorrectly expected the entire select tag to disappear. Blocking actually retains an empty placeholder while removing the choices. The assertion was corrected before the reported baseline. That assertion failure is not counted as a privacy reproduction.

### 2. Temporary strict prototype

Temporarily removed the custom-multiselect fallback, rebuilt rrweb, and reran exactly the same suites. The nine privacy regressions passed. The dedicated red-to-green command was:

```sh
pnpm retest test/record/custom-multiselect-privacy-investigation.browser.test.ts \
  --maxWorkers=1 --minWorkers=1 -t 'regression: custom redaction'
```

Result: **nine pass**, with the nine then-existing unrelated characterization cases filtered by the focused command.

The surrounding prototype run had 20 passing / 15 failing cases. Fourteen failures belong to the existing legacy suite, including nine actual passthrough selection mismatches, two virtual-seek cases, two blocked-path legacy expectations, and the explicitly retained custom-redactor legacy assertion. The fifteenth is a characterization asserting that the old attribute leak remains with `ignoreSelector`; naturally that assertion ceases to hold once attributes are suppressed. These are not fifteen independent new bugs. The nine core passthrough cases demonstrate the compatibility tradeoff.

- `/tmp/posthog-multiselect-gap-strict.log`
- `/tmp/posthog-multiselect-gap-strict-privacy-green.log`
- `/tmp/posthog-multiselect-gap-strict-prototype.patch`

The prototype was then reversed exactly, `git diff --exit-code` confirmed restoration, and the original build and failing baseline were rerun. No prototype production edits remain.

### 3. Existing explicit category unmasking works

With `maskAllInputs: false`, all existing sensitive input categories explicitly masked, and `maskInputOptions.select: false`, the four duplicate-value scenarios (attribute addition, defaultSelected, removal, and selected-property updates) preserve the intended selections. The property update emits the existing `selectedOptionIds` array. The input masker is not invoked for the explicitly unmasked select. Other text/password sample secrets remain absent from the recording bytes.

This is a category-wide setting, not a per-element policy. Just combining `maskAllInputs: true` with `maskInputOptions.select: false` does NOT work: recorder option normalization gives `maskAllInputs: true` precedence and masks the select. Turning off maskAllInputs without retaining appropriate masks for other types would also weaken unrelated input protection, so a minimal `{ select: false }` example is not a safe blanket migration recipe.

### 4. Existing blocking is an immediate mitigation

`blockSelector: 'select.private'` prevents selected mutations, input emissions and option labels for that select. Replay retains an empty placeholder. PostHog's default `ph-no-capture` block class uses the same blocking mechanism.

This is safe when hiding the entire sensitive control is acceptable. It is not equivalent to retaining a visible custom-redacted dropdown. `ignoreSelector` alone does not help because it suppresses input events, not the legacy selected attributes.

### 5. String equality cannot be the authorization signal

A passing probe constructs a real multiselect with duplicate values `same`. A passthrough callback and a constant-redacting callback both produce `same`. Their business intent differs, but their scalar result is identical. Comparing returned strings, recognizing stars, or treating callback presence as explicit unmasking would therefore not define a reliable privacy contract.

Running the existing callback once per option does not solve the identity problem: raw option IDs still identify the original choices. Replacing IDs with a list of returned values cannot preserve duplicate-valued option identity in passthrough mode. Calling callbacks with invented probe values would alter their documented inputs and side effects.

### 6. A dynamic policy is not just a recorder boolean

Two synthetic recording probes use the unchanged player to establish the existing wire behavior:

- An initially unmasked snapshot plus a later input with option IDs selects indices `[1, 2]`.
- An initially default-masked snapshot plus the same later input still shows `[]`.

The latter is intentional existing behavior: `applyInput` applies the IDs, then `restoreSelectState` honors the snapshot's `rr_maskedSelect` marker and clears them.

This is NOT reported as an existing PR bug. It is a design constraint for a future policy API that allows an existing select to transition between masked and unmasked states. Snapshot metadata and later decisions must remain consistent. A successful stable-policy prototype would not prove dynamic transitions correct. Choose and test a checkpoint/metadata-transition mechanism or explicitly specify the supported policy lifetime. Reusing the current ID field alone is insufficient for arbitrary policy changes.

These are local synthetic-payload probes, not a deployed-player or ingestion verification.

## Recommended follow-up contract

Agree on the following before implementing a public option:

1. A category-masked select is private unless explicitly authorized for unmasked selection recording. `maskInputFn` controls replacement text, not identity authorization.
2. Private selects emit neither raw selected attributes nor original selected option IDs, including on additions, removals, defaultSelected, native events, property setters and snapshots. Empty selections and callback-output collisions must not accidentally select an unrelated option in replay.
3. Explicitly unmasked selects reuse the existing filtered option-ID path, including duplicate values and explicit empty selections. Blocked options/optgroups are never included. An explicit unmask decision must not override subtree blocking, consent or input-ignore handling.
4. For per-element authorization, prefer a separate explicit mask/unmask policy surface over guessing from a scrubber's string result. An illustrative, NOT approved or implemented shape is a predicate returning mask/unmask/use-category-default. A selector is a simpler alternative if the desired use cases are selector-based. Keep the existing callback string return type intact unless a separate migration design justifies changing it.
5. Decide what absent policy means. Retaining legacy behavior is source-compatible but leaves the gap until migration. Privacy-first interpretation closes the gap but needs explicit compatibility/security-release approval and migration guidance for documented passthrough callbacks.
6. Define dynamic mask/unmask transitions, snapshot markers, dedup invalidation, callback failures and malformed policies. Fail closed without leaking a pending raw attribute, emitting partial IDs, or crashing the host page. Never use the legacy raw-attribute path as an error fallback.

No new masked-option-ID list is needed or justified. For stable decisions, the existing unmasked ID field and masked snapshot marker can represent the two policies; dynamic transitions need additional agreed handling, not an assumption that current player behavior will follow a new recorder predicate.

## Implementation touchpoints after agreement

- Browser public replay types and `lazy-loaded-session-recorder.ts` allowlist/config forwarding.
- rrweb record/observer option types and option normalization.
- Snapshot select value/marker generation and option selected-flag omission, using the owning select's resolved policy.
- Mutation selected-attribute suppression, filtered aggregate input emission, existing batching/frozen delivery and teardown.
- Input emission/dedup, mirror validity, blocked option filtering, iframe ID remapping.
- Matching player/rrdom snapshot and incremental behavior if dynamic policy transitions require a changed interpretation.

Resolve policy consistently across all these paths. Do not resolve independently for an option versus its owner, infer from callback output, or scan the full selected set on every setter.

## Spec, compatibility and incident review

The sdk-specs README lists Session Replay Privacy as the relevant capability. Its spec requires masking before serialization/upload and fail-closed handling; it does not define a browser per-element unmask API. Current callback passthrough is explicitly documented at https://posthog.com/docs/session-replay/privacy#mask-or-un-mask-specific-inputs and exercised by existing integration tests, so silently changing it is a real compatibility decision.

Sources downloaded:

- `/tmp/posthog-multiselect-gap-spec-readme.md`
- `/tmp/posthog-multiselect-gap-privacy-spec.md`
- `/tmp/posthog-multiselect-gap-public-docs.txt`

Incident matcher classes:

- **Serialization/snapshot correctness: yes for the rejected strict-only rollout.** It silently loses multiple/duplicate selections. Native replay assertions in the nine passthrough cases make that visible; no amount of absence-only privacy assertions can replace them.
- **Masking/privacy: yes on the retained legacy path.** The nine failing browser assertions expose selected identity even though static option labels/values may legitimately remain in the snapshot. Mask before event serialization, not in the viewer or upload wrapper. The text/password control checks assert secret absence from the complete emitted payload.
- **Future lazy-load boundary risk:** any public policy must be forwarded by the SDK allowlist and supported by the recorder it loads. A newer recorder cannot recover a policy that an older core discarded. Define mixed-version behavior and test pinned-core/new-recorder compatibility; do not promise an opt-in privacy guarantee when its controlling option can be ignored.

No transport, consent, session rotation or start-condition code changed. No production service or cloud player was exercised. The proposed API is not implemented, and no matching release/deployment is claimed.

## Remaining validation for an actual fix

Before opening a follow-up PR, convert the nine red investigations to a retained green regression suite under the agreed contract, migrate the legacy compatibility expectations explicitly, and add mixed private/public controls in the same document. Cover initial selections, empty/duplicate/star values, callback collisions, policy transitions and errors, snapshots/checkouts, virtual/real play and seeks, blocked ancestors, iframes/shadow DOM, frozen delivery, repeated stop, burst scan counts, unrelated input masking, and old-core/new-recorder compatibility where applicable.

Current investigation validation is intentionally focused, not a claim of a green repository suite: 9 privacy regressions fail / 28 controls pass on the original head; temporary strict prototype makes those 9 pass while exposing the compatibility failures. Frozen install, recorder builds, scoped lint and test formatting succeeded.
