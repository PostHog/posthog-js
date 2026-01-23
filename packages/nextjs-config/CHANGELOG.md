# @posthog/nextjs-config

## 1.8.4

### Patch Changes

- Updated dependencies [[`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522)]:
  - @posthog/core@1.14.0
  - @posthog/webpack-plugin@1.2.10

## 1.8.3

### Patch Changes

- Updated dependencies [[`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705)]:
  - @posthog/core@1.13.0
  - @posthog/webpack-plugin@1.2.9

## 1.8.2

### Patch Changes

- Updated dependencies [[`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054), [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4)]:
  - @posthog/core@1.12.0
  - @posthog/webpack-plugin@1.2.8

## 1.8.1

### Patch Changes

- Updated dependencies [[`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11)]:
  - @posthog/core@1.11.0
  - @posthog/webpack-plugin@1.2.7

## 1.8.0

### Minor Changes

- [#2930](https://github.com/PostHog/posthog-js/pull/2930) [`c9b773a`](https://github.com/PostHog/posthog-js/commit/c9b773aefd25fcc81a60dff02348e8e724b87565) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: Bump node min. ^20.20.0 || >=22.22.0 due to https://nodejs.org/en/blog/vulnerability/january-2026-dos-mitigation-async-hooks
  (2026-01-19)

## 1.7.6

### Patch Changes

- Updated dependencies [[`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2)]:
  - @posthog/core@1.10.0
  - @posthog/webpack-plugin@1.2.6

## 1.7.5

### Patch Changes

- Updated dependencies [[`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026), [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514)]:
  - @posthog/core@1.9.1
  - @posthog/webpack-plugin@1.2.5

## 1.7.4

### Patch Changes

- [#2804](https://github.com/PostHog/posthog-js/pull/2804) [`5c2cea5`](https://github.com/PostHog/posthog-js/commit/5c2cea5afea46527120d6cf6ff37956ffb98ebef) Thanks [@hpouillot](https://github.com/hpouillot)! - add batchSize option for sourcemap upload control
  (2025-12-22)
- Updated dependencies [[`5c2cea5`](https://github.com/PostHog/posthog-js/commit/5c2cea5afea46527120d6cf6ff37956ffb98ebef), [`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e)]:
  - @posthog/webpack-plugin@1.2.4
  - @posthog/core@1.9.0

## 1.7.3

### Patch Changes

- Updated dependencies [[`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5)]:
  - @posthog/core@1.8.1
  - @posthog/webpack-plugin@1.2.3

## 1.7.2

### Patch Changes

- Updated dependencies [[`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde)]:
  - @posthog/core@1.8.0
  - @posthog/webpack-plugin@1.2.2

## 1.7.1

### Patch Changes

- Updated dependencies [[`c5f3f65`](https://github.com/PostHog/posthog-js/commit/c5f3f6509fefeb4ad74c11f188fc03c4f0199236)]:
  - @posthog/webpack-plugin@1.2.1

## 1.7.0

### Minor Changes

- [#2741](https://github.com/PostHog/posthog-js/pull/2741) [`5c14781`](https://github.com/PostHog/posthog-js/commit/5c14781dc0b791e3fbdc3d9507dc52ccf1eb9ca4) Thanks [@hpouillot](https://github.com/hpouillot)! - upgrade webpack-plugin package
  (2025-12-13)

### Patch Changes

- Updated dependencies [[`5c14781`](https://github.com/PostHog/posthog-js/commit/5c14781dc0b791e3fbdc3d9507dc52ccf1eb9ca4)]:
  - @posthog/webpack-plugin@1.2.0

## 1.6.4

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
  - @posthog/core@1.7.1
  - @posthog/webpack-plugin@1.1.4

## 1.6.3

### Patch Changes

- Updated dependencies [[`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
  - @posthog/core@1.7.0
  - @posthog/webpack-plugin@1.1.3

## 1.6.2

### Patch Changes

- [#2660](https://github.com/PostHog/posthog-js/pull/2660) [`5f0bc7c`](https://github.com/PostHog/posthog-js/commit/5f0bc7ca755457d4bb6e2ac4f0cf7ef944034983) Thanks [@hpouillot](https://github.com/hpouillot)! - fix chunk resolution
  (2025-12-01)
- Updated dependencies [[`5f0bc7c`](https://github.com/PostHog/posthog-js/commit/5f0bc7ca755457d4bb6e2ac4f0cf7ef944034983)]:
  - @posthog/webpack-plugin@1.1.2

## 1.6.1

### Patch Changes

- Updated dependencies [[`07457bf`](https://github.com/PostHog/posthog-js/commit/07457bfece0f3e4798a2c5c68e178250139ce505)]:
  - @posthog/webpack-plugin@1.1.1

## 1.6.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
  - @posthog/core@1.6.0
  - @posthog/webpack-plugin@1.1.0

## 1.5.1

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
  - @posthog/core@1.5.6
  - @posthog/webpack-plugin@1.0.1

## 1.5.0

### Minor Changes

- [#2589](https://github.com/PostHog/posthog-js/pull/2589) [`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f) Thanks [@hpouillot](https://github.com/hpouillot)! - use webpack plugin
  (2025-11-20)

### Patch Changes

- Updated dependencies [[`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f), [`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f)]:
  - @posthog/webpack-plugin@1.0.0
  - @posthog/core@1.5.5

## 1.4.2

### Patch Changes

- Updated dependencies [[`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288)]:
  - @posthog/core@1.5.4

## 1.4.1

### Patch Changes

- Updated dependencies [[`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab)]:
  - @posthog/core@1.5.3

## 1.4.0

### Minor Changes

- [#2552](https://github.com/PostHog/posthog-js/pull/2552) [`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9) Thanks [@hpouillot](https://github.com/hpouillot)! - expose cliBinaryPath and logLevel options

### Patch Changes

- Updated dependencies [[`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9)]:
  - @posthog/core@1.5.2

## 1.3.10

### Patch Changes

- Updated dependencies [[`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58)]:
  - @posthog/core@1.5.1

## 1.3.9

### Patch Changes

- Updated dependencies [[`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606)]:
  - @posthog/core@1.5.0

## 1.3.8

### Patch Changes

- [#2507](https://github.com/PostHog/posthog-js/pull/2507) [`1441574`](https://github.com/PostHog/posthog-js/commit/1441574da9509a5c6c131313c2ba217a60d8038c) Thanks [@daibhin](https://github.com/daibhin)! - Support NextJS 16 switching to turbopack as a default

## 1.3.7

### Patch Changes

- Updated dependencies [[`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51)]:
  - @posthog/core@1.4.0

## 1.3.6

### Patch Changes

- [#2474](https://github.com/PostHog/posthog-js/pull/2474) [`5c89f78`](https://github.com/PostHog/posthog-js/commit/5c89f7828a39963b0fee23d0d9b8381bd87b0bf4) Thanks [@oliverb123](https://github.com/oliverb123)! - Bumps to depending on latest posthog-cli version, includes critical fix for sourcemap processing bug

## 1.3.5

### Patch Changes

- Updated dependencies [[`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34)]:
  - @posthog/core@1.3.1

## 1.3.4

### Patch Changes

- [#2450](https://github.com/PostHog/posthog-js/pull/2450) [`4ef7051`](https://github.com/PostHog/posthog-js/commit/4ef7051bc1d29a4013227f910b6a060969486136) Thanks [@daibhin](https://github.com/daibhin)! - bump the @posthog/cli version

## 1.3.3

### Patch Changes

- Updated dependencies [[`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa), [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682)]:
  - @posthog/core@1.3.0

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
