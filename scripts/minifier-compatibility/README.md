# Browser minifier compatibility probe

**Decision: retain production Terser.** Neither evaluated replacement clears the compatibility gate. This is a diagnostic workspace, not a build plugin or a release change. No runtime configuration, reservation, mangled-name inventory, public API, or published dependency changes.

Assessed on 2026-09-16 against `916e16394de38e01789309ea314f23e6ad436c46`:

| Candidate                         | Version            | Result                                                                                                                                      |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Production Terser                 | 5.48.0             | Reference behavior                                                                                                                          |
| Oxc exposed by installed Rolldown | Rolldown 1.2.4     | No property-mangling API; passed `mangleProps` options are silently ignored                                                                 |
| Standalone Oxc                    | oxc-minify 0.149.0 | Can import property mappings, but semantic and source-map counterexamples remain                                                            |
| SWC                               | @swc/core 1.16.2   | Property assignments diverge across separate calls despite sharing the native cache; cannot import Terser mappings; semantic counterexample |

Oxc 0.149.0 was published September 7; 0.150.0 was published September 14 and was excluded by the repository's seven-day dependency cooldown. SWC 1.16.2 was published September 4. The comparison does not claim results for untested versions. See the [Oxc registry metadata](https://registry.npmjs.org/oxc-minify) and [SWC registry metadata](https://registry.npmjs.org/@swc%2fcore).

## Reproduce

From the repository root using its Node 24 environment:

```sh
pnpm install --frozen-lockfile
pnpm --dir scripts/minifier-compatibility install --frozen-lockfile
node --test scripts/minifier-compatibility/probe.test.mjs
```

The 17 passing tests include **expected reproductions of blockers**. A green run means the documented assessment was reproduced, **not** that a replacement is safe. If a candidate upgrade fixes a counterexample, the corresponding assertion should fail and prompt reassessment.

The standalone lockfile keeps experimental SWC optional peers out of the main workspace's ts-node, webpack, and other dependency graphs. It retains `minimumReleaseAge: 10080`; SWC's postinstall is disabled and the installed platform-specific native package is used directly. Nothing imports this workspace during an SDK build. It needs no SDK build and does not upgrade Vitest or depend on transformer changes in another branch.

## Existing contract

[`rollup.config.mjs`](../../packages/browser/rollup.config.mjs) runs Terser after Rolldown's final rendering, serializes calls, shares `nameCache.props`, and resets `nameCache.vars` for every chunk. Source maps are chained from the transformer/bundler into Terser, then every source receives both ignore-list fields.

The property selector is `/^_(?!_)/`, with explicit reservations. The ES5 and no-external outputs intentionally do not mangle properties. The slim cores and extension bundle additionally reserve the private ABI in [`terser-cross-bundle-properties.cjs`](../../packages/browser/terser-cross-bundle-properties.cjs). In particular, `_addCaptureHook` and `_send_request` are globally reserved for older separate extensions. Public names, double-underscore names, and other reserved strings must stay unchanged.

[`terser-mangled-names.json`](../../packages/browser/terser-mangled-names.json) contains **966 original property spellings**, not an original-to-short-name dictionary. The build writes the inventory when requested; it does not read it to seed the cache. Its CI diff gate detects additions, not remapped output names. Fresh cache allocation can change with chunk order or source changes. The probe demonstrates that distinction; it does not introduce a new persisted mapping or reinterpret the file.

Historical compatibility therefore cannot be inferred from equal inventories or from a same-build cache. Reserved boundary names protect specific old/unmangled consumers; a mangled boundary needs matching actual assignments. A new persisted cache would require independently establishing all deployed contracts, not inventing mappings from the inventory.

## Hard failures

1. **Installed Rolldown's Oxc lacks property mangling.** Its `MinifyOptions` has no `mangleProps` or property cache. The fixture still has `_privateProbe` after minification. Removing property mangling is not equivalent and is not proposed.
2. **SWC's shared native cache does not preserve property assignments across calls.** For a reduced core defining `_sharedProbe` and `_unrelated`, SWC emits `_sharedProbe` as `e`. A separately minified extension accesses `l`, despite using the same `experimental_newMangleNameCache()` object. Execution throws. The cache is an opaque native external value, serializes as `{}`, and rejects a plain Terser-shaped cache. This blocks the existing serialized shared-property-cache contract before release-skew concerns arise.
3. **Oxc changes computed-property runtime behavior.** For `var o={_privateProbe:7}; globalThis.result=o["_private"+"Probe"];`, Terser and SWC return `7`; Oxc returns `undefined`. Oxc mangles the definition before compression folds the computed key, then does not revisit the access. This also happens with `quoted:true`. It is a reduced semantic counterexample, not a claim that this exact expression exists in a shipped SDK. Oxc documents this [property-mangling assumption](https://github.com/oxc-project/oxc/blob/main/crates/oxc_minifier/docs/ASSUMPTIONS.md).
4. **SWC changes property-membership behavior.** For `var o={_privateProbe:7}; globalThis.result="_privateProbe" in o;`, Terser and Oxc return `true`; SWC returns `false`. The object key is mangled and the string in the membership test is not. This is likewise a contract counterexample, not a demonstrated fleet incident. Known rrweb membership checks such as `_cssText` are already reserved and must remain so.
5. **Oxc loses a property-definition map name.** For the function-valued `_sharedProbe` definition in the reduced core, Terser and SWC include the original spelling in `map.names`; Oxc does not. The existing [ABI checker](../../packages/browser/scripts/check-mangled-property-consistency.js) uses named source-map segments to classify definitions/accesses, so merely emitting a valid map is insufficient. No checker or Babel fallback was weakened to accommodate this.
6. **Oxc rejects an ES5 compression target.** The standalone minifier rejects `compress.target: 'es5'`, even for ES5 input. The installed browser pipeline still emits and syntax-checks an ES5 artifact. Retaining Terser for that artifact could be part of a future partial migration, but does not resolve the modern-bundle failures above. An ES2015/default target is not proof of ES5 output safety.

The adapters already address two fixable API differences: Rust regex engines reject the current negative lookahead (use equivalent include/exclude selection in Oxc and `^_($|[^_])` in SWC), and Oxc requires `quoted:true` to match Terser's handling of quoted occurrences. These adjustments do not fix the hard failures. See the upstream [Oxc mangling API](https://oxc.rs/docs/guide/usage/minifier/mangling.html) and [SWC minification API](https://swc.rs/docs/configuration/minification); the executable evidence is pinned to the versions above.

## Positive evidence and limits

| Area                         | Evidence                                                                                                                                                                                                      | Remaining gate                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Existing names / persistence | Oxc imports and JSON-round-trips a Terser-generated map for all 966 inventoried names without changing any assignment                                                                                         | This is a fixture-generated map, not a recovered mapping from all historical releases                                             |
| Determinism                  | Terser/Oxc repeat identical input, extend serial caches without remapping existing entries, and restart from serialized property caches; fresh build order can change assignments                             | Cross-process and full-build ordering need validation for any future plugin                                                       |
| Separately loaded bundles    | Terser/Oxc shared-cache fixtures execute; Oxc seeded from Terser executes old-core/new-lazy and new-core/old-lazy pairs; unseeded Oxc fails the synthetic mangled boundary; SWC shared-cache pair fails       | Synthetic mangled properties model the cache contract; they are not claimed to be actual public or reserved SDK ABI               |
| Old/unmangled boundary       | All nine Terser/Oxc/SWC reduced core/lazy combinations pass with classified reservations, including inverse pairs; unmangled core also passes with each minified lazy fixture                                 | Reduced fixtures are not historical npm binaries or real-browser SDK integration tests                                            |
| Cold start                   | Reduced fixtures start from saved config lacking a timestamp, tolerate absent config, and receive an explicitly delayed remote-config callback afterward                                                      | No real browser, network, storage, recorder, or recording-volume coverage is claimed                                              |
| Syntax/runtime/compression   | ES2015 parser check; ES5 parser checks for Terser/SWC on already-lowered input; side effects, exceptions, negative zero, missing globals, quoted access, reservations, and dead-code elimination smoke checks | No complete modern syntax matrix, DOM/WebKit/IE11 behavior, or equivalence of all Terser unsafe compression settings              |
| Source maps                  | All three produce decodable maps with named property-access segments in a simple fixture                                                                                                                      | Oxc loses a definition name. No end-to-end Babel/Oxc/Rolldown map-chain or ignore-list validation was completed for a candidate   |
| Size / build time            | Production build pipeline and output are unchanged by this diagnostic-only change                                                                                                                             | Full SDK raw/gzip/Brotli sizes and build timings deliberately not measured after hard failures; no performance benefit is claimed |

Before reconsidering migration, fix the counterexamples without removing protections, demonstrate actual property-cache coordination and historical compatibility, implement source-map chaining with both ignore lists, and run the existing built ABI checks and real-browser compat suite with explicit old versions. Cover old pinned core plus new lazy bundles, delayed config and persisted state, and the inverse cached-lazy/new-core pairing where supported. Preserve the existing Oxc/Babel transformation split. Only then compare full production artifact sizes and repeatable build timings against this base.

## Replay incident review

Class 1, lazy-load version skew, resembles INC-749 and the older-core survey failures: a newly published extension can encounter an older core through legacy/fallback loading. For the **shipped diff: no same failure mode**. No runtime function signature, core call, persisted-state read, or emitted artifact changes. The reduced fixtures exercise those contracts but do not replace the old-core real-browser suite. For an SWC replacement, **yes**: the reduced shared-property boundary already throws. For an Oxc replacement, **cannot establish safety** given the semantic and map failures.

The mechanical incident matcher reports no matching classes for these diagnostic/documentation paths; this manual lazy-boundary assessment remains relevant to the rejected migration. There is no release, changeset, or recording-volume change to monitor from this diff. Runtime/publishable changes would require a `posthog-js` changeset, never an rrweb package changeset.
