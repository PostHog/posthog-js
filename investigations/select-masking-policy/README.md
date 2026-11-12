# Archived no-policy privacy reproductions

`legacy-privacy.repro.txt` is the byte-for-byte archive of the previous `packages/rrweb/rrweb/test/record/custom-multiselect-privacy-investigation.browser.test.ts`.

Archive SHA-256: `059db71fbc5755b4fe444bcf42747e52417828d74bb9e7ff3be2e2fc9c5d5232`.

The nine tests named `regression: custom redaction must not expose selected identity` intentionally fail without `selectMaskingFn`. That legacy gap is not fixed automatically: preserving existing configurations was an explicit compatibility requirement. The archive uses `.repro.txt` rather than `.test.ts` so it is research evidence, not a permanently excluded CI test.

The regular `select-masking-compatibility.browser.test.ts` retains all parameterized scenarios. It asserts the approved legacy wire format when the option is absent and unchanged privacy assertions for the opt-in variants. A probe comparing only fixture callbacks remains in the archive, not CI; the policy suite retains the actual recorder/player collision regression. No CI discovery configuration or global skip was added.

To reproduce the historical failure in this worktree, copy this archive to a fresh temporary filename under `packages/rrweb/rrweb/test/record/` (its imports assume that location), build rrweb, and run that file with the existing Brave Puppeteer setup. Expect nine failures and 21 passing opt-in/control cases. Remove only the temporary copy afterward, not this archive.
