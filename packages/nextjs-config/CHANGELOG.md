# @posthog/nextjs-config

## 1.3.2

### Patch Changes

- [#2419](https://github.com/PostHog/posthog-js/pull/2419) [`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - move binary calling logic to core package

- Updated dependencies [[`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf)]:
  - @posthog/core@1.2.4

## 1.3.1

### Patch Changes

- [#2334](https://github.com/PostHog/posthog-js/pull/2334) [`b1f0c3c`](https://github.com/PostHog/posthog-js/commit/b1f0c3c2e24e2434bb687d9cb24f2d981bb539ed) Thanks [@hpouillot](https://github.com/hpouillot)! - improve posthog-cli location search

- [#2337](https://github.com/PostHog/posthog-js/pull/2337) [`ac1cafe`](https://github.com/PostHog/posthog-js/commit/ac1cafe34aa55a205e6d88d8f3093e350d8a8ae2) Thanks [@hpouillot](https://github.com/hpouillot)! - fix posthog-cli execution on windows

## 1.3.0

### Minor Changes

- [#2273](https://github.com/PostHog/posthog-js/pull/2273) [`48ed95b`](https://github.com/PostHog/posthog-js/commit/48ed95b0d89677bc26a94bb57acffae986bdb07e) Thanks [@marandaneto](https://github.com/marandaneto)! - nextjs-config bump min node version to 20

## 1.2.1

### Patch Changes

- [#2275](https://github.com/PostHog/posthog-js/pull/2275) [`401d076`](https://github.com/PostHog/posthog-js/commit/401d07622886f8a3e5fa2847c1a3f34e773a9d13) Thanks [@hpouillot](https://github.com/hpouillot)! - bump @posthog/cli version

## 1.2.0

### Minor Changes

- [#2227](https://github.com/PostHog/posthog-js/pull/2227) [`2bb53b3`](https://github.com/PostHog/posthog-js/commit/2bb53b3d1aeb1107ed5c123d3a862626c30c7657) Thanks [@jrhe](https://github.com/jrhe)! - add turbopack support

## 1.1.2

### Patch Changes

- [#2194](https://github.com/PostHog/posthog-js/pull/2194) [`faa2f28`](https://github.com/PostHog/posthog-js/commit/faa2f2868762c527148d9a59098d4eae7f0b3ffb) Thanks [@benjaminshawki](https://github.com/benjaminshawki)! - fix typescript typings

## 1.1.1

### Patch Changes

- [#2182](https://github.com/PostHog/posthog-js/pull/2182) [`970e3fd`](https://github.com/PostHog/posthog-js/commit/970e3fda0aa6e21403079fe65791c466525081dc) Thanks [@hpouillot](https://github.com/hpouillot)! - add support for esm next config

## 1.1.0

### Minor Changes

- [#2123](https://github.com/PostHog/posthog-js/pull/2123) [`6f3390e`](https://github.com/PostHog/posthog-js/commit/6f3390e8eda844d3ff2ace0f57bedb3230c72319) Thanks [@hpouillot](https://github.com/hpouillot)! - upgrade @posthog/cli to fix a vulnerability with axios < 1.8.2

## 1.0.2

- fix: search for posthog-cli binary from the @posthog/nextjs-config package
- chore: add error messages
- chore: bump @posthog/cli dependency to 0.3.5
- feat: take distDir into account when looking for sources

## 1.0.1

- Fix build issues on vercel deployment (xz system library missing)

## 1.0.0

- generate nextjs configuration for sourcemap generation
- inject chunk ids into emitted assets
- automatically upload sourcemaps to PostHog
- optionally remove sourcemaps from emitted assets after upload
