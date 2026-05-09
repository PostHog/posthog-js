# @rrweb/record

## 0.0.63

### Patch Changes

- Updated dependencies []:
    - @posthog/rrweb@0.0.63

## 0.0.62

### Patch Changes

- [#3527](https://github.com/PostHog/posthog-js/pull/3527) [`33aa019`](https://github.com/PostHog/posthog-js/commit/33aa019c04a77b7657ec008307b37a7fb9c52629) Thanks [@TueHaulund](https://github.com/TueHaulund)! - Skip canvas snapshot while WebGL context is lost. On mobile under GPU
  pressure or tab backgrounding, `createImageBitmap` returns a transparent
  bitmap rather than throwing for a context-lost WebGL canvas. The worker's
  first-frame transparency check then suppresses emission and stores the
  transparent fingerprint in `lastFingerprintMap`, so once the context
  restores and three.js re-renders, identical-fingerprint frames get
  deduped against the transparent baseline and the canvas appears to never
  record. Pre-flight `gl.isContextLost()` and skip the snapshot while the
  context is down. Also wrap the `getCanvas()` shadow-root walk in
  try/catch so a traversal exception cannot cancel the rAF loop and
  silently kill canvas recording for the rest of the session. (2026-05-05)
- Updated dependencies [[`33aa019`](https://github.com/PostHog/posthog-js/commit/33aa019c04a77b7657ec008307b37a7fb9c52629)]:
    - @posthog/rrweb@0.0.62

## 0.0.61

### Patch Changes

- [#3510](https://github.com/PostHog/posthog-js/pull/3510) [`a5d86c9`](https://github.com/PostHog/posthog-js/commit/a5d86c9dbeda7d5f757c5d2216431b64cfcec474) Thanks [@arnaudhillen](https://github.com/arnaudhillen)! - Move posthog-rrweb sources into the posthog-js monorepo under `packages/rrweb/`.
  The seven packages we publish (`@posthog/rrweb`, `@posthog/rrweb-types`,
  `@posthog/rrweb-utils`, `@posthog/rrdom`, `@posthog/rrweb-snapshot`,
  `@posthog/rrweb-record`, `@posthog/rrweb-plugin-console-record`) now release
  from this repo via the existing changesets pipeline. No runtime behavior
  changes. (2026-05-05)
- Updated dependencies [[`a5d86c9`](https://github.com/PostHog/posthog-js/commit/a5d86c9dbeda7d5f757c5d2216431b64cfcec474)]:
    - @posthog/rrweb@0.0.61
    - @posthog/rrweb-types@0.0.61
    - @posthog/rrweb-utils@0.0.61

## 2.0.0-alpha.18

### Patch Changes

- [#1597](https://github.com/rrweb-io/rrweb/pull/1597) [`bd9eb70`](https://github.com/rrweb-io/rrweb/commit/bd9eb70629aeb5970f6188025f184ff4b0d5dcd4) Thanks [@pauldambra](https://github.com/pauldambra)! - Correctly detect when angular has wrapped mutation observer

- Updated dependencies [[`04ee6ed`](https://github.com/rrweb-io/rrweb/commit/04ee6eda57157f0e04f18f907d8f3e59ababc753), [`5fbb904`](https://github.com/rrweb-io/rrweb/commit/5fbb904edb653f3da17e6775ee438d81ef0bba83), [`5a78938`](https://github.com/rrweb-io/rrweb/commit/5a789385a341311ba327a768fe0e2f0f2f5002ee), [`53b83bb`](https://github.com/rrweb-io/rrweb/commit/53b83bb037f9cb30c93179548f436ed776f143ab)]:
    - rrweb@2.0.0-alpha.18
    - @rrweb/types@2.0.0-alpha.18

## 2.0.0-alpha.17

### Patch Changes

- [`db20184`](https://github.com/rrweb-io/rrweb/commit/db201841accd2b5df3cd7c88779aa62ab158501c) Thanks [@Juice10](https://github.com/Juice10)! - Keep package version in sync with other packages

- [#1515](https://github.com/rrweb-io/rrweb/pull/1515) [`8059d96`](https://github.com/rrweb-io/rrweb/commit/8059d9695146626b102b2059a3a9b932d5f598f6) Thanks [@okejminja](https://github.com/okejminja)! - Added support for deprecated addRule & removeRule methods

- Updated dependencies [[`40bbc25`](https://github.com/rrweb-io/rrweb/commit/40bbc25fc287badc317a53f2d3f21b1c9f2b211b), [`68076b7`](https://github.com/rrweb-io/rrweb/commit/68076b724ff19d198d4f351a05063b85e1705a8c), [`8059d96`](https://github.com/rrweb-io/rrweb/commit/8059d9695146626b102b2059a3a9b932d5f598f6), [`335639a`](https://github.com/rrweb-io/rrweb/commit/335639af9b0ce7f70eb0f38ce113d877c7325158), [`be6bf52`](https://github.com/rrweb-io/rrweb/commit/be6bf52c248c35de1b3491e3a3440ff61f876414)]:
    - rrweb@2.0.0-alpha.17
    - @rrweb/types@2.0.0-alpha.17

## 2.0.0-alpha.15

### Major Changes

- [#1497](https://github.com/rrweb-io/rrweb/pull/1497) [`2606a2a`](https://github.com/rrweb-io/rrweb/commit/2606a2a28f2a6d897b8ae4ea3ec40ef0eeacbfaf) Thanks [@Juice10](https://github.com/Juice10)! - Distributed files have new filenames, paths and extensions. **Important: If you reference distributed files or types directly, you might have to update your paths/filenames. E.g. you import from `rrweb/typings/...` or `rrdom/es`. However you run `import rrweb from '@posthog/rrweb'` you won't notice a difference with this change.** If you include rrweb files directly in a script tag, you might have to update that path to include a the `.umd.cjs` files instead. All `.js` files now use ES modules which can be used in modern browsers, node.js and bundlers that support ES modules. All npm packages now also ship `.cjs` and `.umd.cjs` files. The `.umd.cjs` files are CommonJS modules that bundle all files together to make it easy to ship one file to browser environments (similar to the previous `.js` files). The `.cjs` files are CommonJS modules that can be used in older Node.js environments. Types should be better defined in `package.json` and if you need specific types they might be exported from new packages (for example `PlayerMachineState` and `SpeedMachineState` are now exported from `@rrweb/replay`). Check the `package.json`'s `main` and `exports` field for the available files.

- [#1497](https://github.com/rrweb-io/rrweb/pull/1497) [`2606a2a`](https://github.com/rrweb-io/rrweb/commit/2606a2a28f2a6d897b8ae4ea3ec40ef0eeacbfaf) Thanks [@Juice10](https://github.com/Juice10)! - Remove the rrweb-all.js, rrweb-record.js, and rrweb-replay.js files from `rrweb` package. Now you can use `@rrweb/all`, `@rrweb/record`, and `@rrweb/replay` packages instead. Check out the README of each package for more information or check out [PR #1033](https://github.com/rrweb-io/rrweb/pull/1033) to see the changes.

### Patch Changes

- Updated dependencies [[`7261c43`](https://github.com/rrweb-io/rrweb/commit/7261c43f60973e88325edf832e4d0e057fbff0ae), [`4014305`](https://github.com/rrweb-io/rrweb/commit/40143059446cee5c042c007b1c2e976f36e172f5), [`609b7fa`](https://github.com/rrweb-io/rrweb/commit/609b7fac79a552f746dc880a28927dee382cd082), [`82f6fec`](https://github.com/rrweb-io/rrweb/commit/82f6fecf36413ecbc994a510144487f1de20d1d5), [`2606a2a`](https://github.com/rrweb-io/rrweb/commit/2606a2a28f2a6d897b8ae4ea3ec40ef0eeacbfaf), [`2606a2a`](https://github.com/rrweb-io/rrweb/commit/2606a2a28f2a6d897b8ae4ea3ec40ef0eeacbfaf), [`5c27b76`](https://github.com/rrweb-io/rrweb/commit/5c27b763192bda9dd91806f95df7c1cd0ab083a6), [`d38893f`](https://github.com/rrweb-io/rrweb/commit/d38893f6338facf331fd1f6e63c121120b81177d), [`d7cf8dd`](https://github.com/rrweb-io/rrweb/commit/d7cf8dd07547f6fb22ef82e341a88357c4053bd3), [`2606a2a`](https://github.com/rrweb-io/rrweb/commit/2606a2a28f2a6d897b8ae4ea3ec40ef0eeacbfaf), [`e08706a`](https://github.com/rrweb-io/rrweb/commit/e08706ae60268b6eb05c6292ef948c71bd423ce3)]:
    - rrweb@2.0.0-alpha.15
    - @rrweb/types@2.0.0-alpha.15
