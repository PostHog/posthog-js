# Remaining modern Babel entries

The September 2026 investigation against `916e16394de38e01789309ea314f23e6ad436c46`
retains Babel for `extension-bundles`, `module.slim`, and `module.slim.no-external`.
The pinned Rolldown 1.2.4 / Oxc 0.144.0 toolchain does **not** reproduce the previously
reported loss of the seven required ABI property mappings. It does reproduce a
separate tree-shaking regression, so removing Babel is not yet safe under the
existing artifact checks. ES5 and TestCafe still need their existing Babel paths.

## Reproduce

Install this checkout's dependencies and build prerequisites from the root:

```sh
pnpm install --frozen-lockfile
pnpm turbo run build --filter=posthog-js
node packages/browser/scripts/investigate-oxc-bundles.mjs --minimal
node packages/browser/scripts/investigate-oxc-bundles.mjs
```

The minimal probe requires only dependency installation. It bundles:

```js
export const keep = 1
const unused = async () => {
    await sideEffect()
}
```

Without target lowering, the unused arrow and its body disappear. With the existing
modern ES2015/browser targets, Oxc introduces an initializer calling
`_asyncToGenerator`. Rolldown retains that initializer and `sideEffect`, even though
`unused` is never read. Babel's production output transform runs **after**
tree-shaking and therefore does not introduce this initializer until unused code
has already been removed. No source-map name recovery can fix this ordering issue.

The full probe builds the three real entries into a reported temporary directory,
leaving `dist` untouched. Each variant uses a fresh process and one shared production
Terser name cache across its three entries. The only candidate changes are removing
the Babel plugin and enabling the existing `modernTransformOptions`. Visualizer is
excluded from both timing samples. Reports include raw/gzip/Brotli sizes, timings,
compression sources, both ignore lists, and checks using the production property
extractor and classification rules. An Oxc report containing errors is diagnostic;
the command succeeding is **not** a migration approval or a substitute for postbuild.

## Results

One local warm measurement on Node 24.21.0, with dependencies already built:

| Entry                   | Babel seconds | Oxc seconds | Babel bytes | Oxc bytes | Babel gzip | Oxc gzip | Babel Brotli | Oxc Brotli |
| ----------------------- | ------------: | ----------: | ----------: | --------: | ---------: | -------: | -----------: | ---------: |
| extension-bundles       |         1.240 |       0.631 |      166722 |    176335 |      52678 |    53788 |        45603 |      46550 |
| module.slim             |         0.776 |       0.497 |      150201 |    156291 |      51279 |    52073 |        44346 |      45066 |
| module.slim.no-external |         0.668 |       0.392 |      165613 |    171564 |      52801 |    53620 |        45284 |      46016 |

These are selected-entry builds sharing a cache, not full-build size estimates:
previous entries in a full build can change the mangled spellings. Timing is a
single noisy sample, not a statistical speed claim. The candidate saved roughly
1.16 seconds across these entries but increased each compressed size.

Both variants preserve the seven required cross-boundary property mappings and
consistent shared access spellings. Both source-map ignore lists cover every source.
The candidate adds `_encodedBody` and `_objectSpread2` to the observed no-external
overlaps and removes `_extends`. The unchanged classification gate rejects this
with unknown/stale classifications. `_objectSpread2` replaces Babel's loose spread
helper, so matching runtime semantics also needs review before migration.

More decisively, the candidate's extension bundle includes `core/dist/gzip.mjs`,
which is absent from the Babel artifact. The existing built-output regression in
`src/__tests__/entrypoints/module.test.ts` rejects it. This is not evidence that the
entire transport table or fflate is retained: `AVAILABLE_TRANSPORTS` remains absent
from that extension map, and fflate is still excluded. Both slim core entries
normally include compression; their presence is not a regression.

A complete candidate production build also fails the unchanged postbuild
classification gate. Running the focused property-extractor, source-map stripping,
and entrypoint/installed-consumer suites against that build yields 40 passing tests
and the one expected compression-exclusion failure. The source-map ignore-list
script passes all 42 maps. The Oxc candidate also passes all 114 existing slim-bundle
Playwright cases across Chromium, Firefox, and WebKit; those runtime smoke tests do
not invalidate the artifact failures.

After restoring Babel, the complete production build and postbuild checks pass,
as do all 41 focused tests, all 114 slim browser cases, the ES5 artifact syntax check, and ES2015 checks for
`array.full` and all three investigated entries. The retained configuration also
passes the three Chromium compatibility cases for stale/persisted config and masked
fetch bodies against pinned `posthog-js@1.360.2`, including delayed cold starts.
No publishable code or dependency changed, so this investigation needs no changeset.

## Follow-up boundary

Fix or upgrade the transformer/bundler's treatment of lowered unused async
initializers, then rerun the probe and the complete production checks. Do not mark
arbitrary helper calls as pure, remove the compression assertion, loosen the target
ceiling, or discard unknown/stale classifications to get a green build.

Moving Oxc into a Babel-style output hook is not a drop-in fix either: its standalone
transform emits imports such as `@oxc-project/runtime/helpers/objectSpread2` in
`Runtime` helper mode, or requires global `babelHelpers` in `External` mode. Those
helpers would need correct bundling and source-map composition after tree-shaking;
shipping new unresolved imports or globals would violate consumer compatibility.

Replay incident review: this investigation concerns the Class 1 lazy-load boundary
(INC-749 and the survey/web-vitals version-skew incidents). The committed change
retains all production transforms, signatures, persisted-state reads, Terser options,
and reservations. It therefore introduces no new assumptions about old cores or
recording volume. A future migration still needs old pinned core/new lazy bundle
coverage, including delayed config and persisted cold starts, as well as both slim
core variants in real browsers.
