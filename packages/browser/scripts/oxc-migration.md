# Browser Oxc migration validation

Baseline: `bff0a440e2fc536efd8a5bf665d49283d4cbf03c` (`posthog-js@1.428.11`), compared with this migration's working tree. Both sides use the same lockfile and production Rolldown/Rollup/Terser pipeline, not the esbuild size proxy.

## Scope and tradeoffs

- Oxc replaces Babel in the modern Rolldown runtime entries (38 of 42 emitted runtime files).
- Babel remains for the ES5 artifact because Oxc's minimum target is ES2015.
- Babel remains in the three Rollup slim/extension entries. An Oxc input-transform experiment failed the existing property ABI guard: source-map names for `_addCaptureHook`, `_onIdentityChanged`, `_onIdentityCleared`, and `_onOptOut` were missing. The guard was not weakened. These three artifacts and the ES5 artifact are byte-identical to baseline.
- No runtime dependencies, minifier settings, public entrypoints, or SDK runtime source files were changed. TestCafe retains its Babel configuration.
- This is not a bundle-size optimization: `array.js` grows 12,341 raw bytes / 932 gzip bytes. Smaller extensions have larger percentage increases: tracing headers grows 243 gzip bytes (14.19%), logs 223 (9.29%), and web-vitals 307 (8.42%). Recorder and survey gzip sizes decrease.

## Production bundle comparison

Sizes include the source-map URL comment but not the separate map. Compression uses Node 24.18.1's default gzip and Brotli settings consistently on both sides.

| Bundle                                   |                Raw bytes |               Gzip bytes |             Brotli bytes |
| ---------------------------------------- | -----------------------: | -----------------------: | -----------------------: |
| all-external-dependencies.js             |  367628 → 373384 (1.57%) | 117530 → 116339 (-1.01%) |   99852 → 98810 (-1.04%) |
| array.full.es5.js                        |  500547 → 500547 (0.00%) |  148930 → 148930 (0.00%) |  123915 → 123915 (0.00%) |
| array.full.js                            |  617820 → 634826 (2.75%) | 194546 → 194461 (-0.04%) | 162083 → 161576 (-0.31%) |
| array.full.no-external.js                |  677339 → 694178 (2.49%) |  200898 → 200909 (0.01%) | 166490 → 165881 (-0.37%) |
| array.js                                 |  289577 → 301918 (4.26%) |    93382 → 94314 (1.00%) |    78781 → 79507 (0.92%) |
| array.no-external.js                     |  329983 → 342203 (3.70%) |    97807 → 98646 (0.86%) |    81775 → 82239 (0.57%) |
| conversations.js                         |    69011 → 70564 (2.25%) |    22047 → 22283 (1.07%) |    19596 → 19820 (1.14%) |
| crisp-chat-integration.js                |    1995 → 1600 (-19.80%) |       893 → 811 (-9.18%) |       771 → 697 (-9.60%) |
| customizations.full.js                   |    18111 → 19145 (5.71%) |      7506 → 7744 (3.17%) |      6758 → 6992 (3.46%) |
| customizations.js                        |    17727 → 18765 (5.86%) |      7356 → 7601 (3.33%) |      6612 → 6869 (3.89%) |
| dead-clicks-autocapture.js               |    18444 → 19417 (5.28%) |      6953 → 7179 (3.25%) |      6306 → 6530 (3.55%) |
| default-extensions.js                    |  287471 → 299735 (4.27%) |    92630 → 93471 (0.91%) |    78193 → 78801 (0.78%) |
| element-inference.js                     |     5617 → 5277 (-6.05%) |     2482 → 2409 (-2.94%) |     2247 → 2175 (-3.20%) |
| exception-autocapture.js                 |    14973 → 15575 (4.02%) |      5513 → 5675 (2.94%) |      4984 → 5163 (3.59%) |
| extension-bundles.js                     |  158598 → 158598 (0.00%) |    49965 → 49965 (0.00%) |    43353 → 43353 (0.00%) |
| external-scripts-loader.js               |     3547 → 3217 (-9.30%) |     1459 → 1397 (-4.25%) |     1242 → 1189 (-4.27%) |
| intercom-integration.js                  |    2047 → 1652 (-19.30%) |       907 → 823 (-9.26%) |       772 → 714 (-7.51%) |
| lazy-recorder.js                         |  208282 → 211420 (1.51%) |   66564 → 65841 (-1.09%) |   57329 → 56711 (-1.08%) |
| logs.js                                  |     5826 → 6760 (16.03%) |      2401 → 2624 (9.29%) |     2208 → 2434 (10.24%) |
| main.js                                  |  294278 → 306663 (4.21%) |    95196 → 96151 (1.00%) |    80051 → 80718 (0.83%) |
| module.full.js                           |  622042 → 639054 (2.73%) | 196092 → 196067 (-0.01%) | 163037 → 162636 (-0.25%) |
| module.full.no-external.js               |  681561 → 698406 (2.47%) |  202440 → 202452 (0.01%) | 167634 → 166889 (-0.44%) |
| module.js                                |  293404 → 305762 (4.21%) |    94937 → 95964 (1.08%) |    79933 → 80645 (0.89%) |
| module.mjs                               |  293405 → 305763 (4.21%) |    94938 → 95965 (1.08%) |    79971 → 80697 (0.91%) |
| module.no-external.js                    |  333806 → 346034 (3.66%) |   99307 → 100194 (0.89%) |    82918 → 83380 (0.56%) |
| module.slim.js                           |  145800 → 145800 (0.00%) |    50062 → 50062 (0.00%) |    43344 → 43344 (0.00%) |
| module.slim.no-external.js               |  160882 → 160882 (0.00%) |    51526 → 51526 (0.00%) |    44323 → 44323 (0.00%) |
| posthog-recorder.js                      |  208156 → 211313 (1.52%) |   66405 → 65566 (-1.26%) |   57370 → 56785 (-1.02%) |
| product-tours-preview.js                 |    80844 → 81358 (0.64%) |    28050 → 28195 (0.52%) |    24405 → 24551 (0.60%) |
| product-tours.js                         |  122053 → 125001 (2.42%) |    41898 → 42031 (0.32%) |    36379 → 36726 (0.95%) |
| recorder-v2.js                           |  129492 → 129715 (0.17%) |   40663 → 39726 (-2.30%) |   35358 → 34586 (-2.18%) |
| recorder.js                              |  129489 → 129712 (0.17%) |   40660 → 39722 (-2.31%) |   35374 → 34589 (-2.22%) |
| rrweb-plugin-console-record.js           |     7797 → 7766 (-0.40%) |     3060 → 3016 (-1.44%) |     2756 → 2739 (-0.62%) |
| rrweb-types.js                           |      2407 → 2407 (0.00%) |        935 → 935 (0.00%) |        845 → 845 (0.00%) |
| rrweb.js                                 | 322346 → 321750 (-0.18%) |   97677 → 95916 (-1.80%) |   66721 → 65720 (-1.50%) |
| surveys-preview.js                       |    79426 → 80454 (1.29%) |   26662 → 26575 (-0.33%) |   23031 → 22966 (-0.28%) |
| surveys.js                               |  100305 → 102446 (2.13%) |   34096 → 33907 (-0.55%) |   29268 → 29172 (-0.33%) |
| tracing-headers.js                       |     3744 → 4713 (25.88%) |     1712 → 1955 (14.19%) |     1553 → 1791 (15.33%) |
| web-vitals-soft-navs.js                  |    9868 → 11062 (12.10%) |      3648 → 3955 (8.42%) |      3316 → 3601 (8.59%) |
| web-vitals-with-attribution-soft-navs.js |    25363 → 27047 (6.64%) |      6802 → 6977 (2.57%) |      5946 → 6121 (2.94%) |
| web-vitals-with-attribution.js           |    25343 → 27027 (6.64%) |      6798 → 6973 (2.57%) |      5952 → 6130 (2.99%) |
| web-vitals.js                            |    9848 → 11042 (12.12%) |      3644 → 3951 (8.42%) |      3315 → 3594 (8.42%) |

Artifact filenames, declarations, ESM export names and external import paths match. CJS/ESM export keys and public prototype descriptors from the unmangled module also match baseline.

## Validation

- Production build and postbuild: pass, including unchanged mangled-property metadata, the slim/extension ABI checks, and ignore lists on all 42 source maps.
- `pnpm --filter=posthog-js test:built`: 5 passed. All runtime outputs parse as ES6; the legacy artifact parses as ES5. CJS/ESM SSR loading, helper scoping, and transformation semantics pass.
- `pnpm --filter=posthog-js test:unit`: 6,342 passed, 8 skipped.
- `pnpm --filter=posthog-js test:functional`: 10 passed.
- Playwright capture, slim-bundle, logs, survey response capture, error autocapture, and session-recording suites: 547 passed, 11 skipped across Chromium, Firefox, and WebKit.
- Baseline Babel `array.js`/`array.full.js` with current Oxc extensions: 42 passed across all three engines. Includes reloading persisted recording configuration while the remote-config response is held, then checking recording resumes in the same session without page errors.
- `pnpm test:dev-watch`: passed for runtime and declaration rebuilds; source edits restored. Dependency outputs were restored from the original Turbo cache before the final production comparison so the rrweb watch build could not affect the measured difference.
- Browser typecheck, browser lint, changed tooling lint, formatting, and build-graph tests: passed.

The first browser attempt reused another worktree's server on port 2345 and had connection failures; its results are not used. The successful runs used this worktree's server on an isolated port (temporary port/config changes were restored afterward).

## Incident and compatibility review

The mechanical incident matcher found no path matches in the 10-file change snapshot; the indirect bundle changes were reviewed manually. The relevant precedent is lazy-bundle version skew (including INC-749's persisted-config startup race). There are no new core method calls, boundary signatures, or persisted fields in runtime source. The cold-start/delayed-config regression now runs in both ordinary and old-core/new-extension testing. Slim property mapping remains guarded rather than accepting the failed Oxc Rollup experiment. No recording thresholds, idle/rotation/flush logic, network wrapper source, or release workflows changed.

This validates the tested behavior, not every historical browser or pinned SDK version. Safari 10.3/IE11 engines were not available locally; ES5/ES6 syntax checks preserve the existing canaries. The size growth is an explicit tradeoff, not a claimed optimization. As with any recorder bundle deployment, watch recording-volume and client-error monitoring after release.
