# @posthog/rollup-plugin

## 1.1.6

### Patch Changes

- [#2804](https://github.com/PostHog/posthog-js/pull/2804) [`5c2cea5`](https://github.com/PostHog/posthog-js/commit/5c2cea5afea46527120d6cf6ff37956ffb98ebef) Thanks [@hpouillot](https://github.com/hpouillot)! - add batchSize option for sourcemap upload control
  (2025-12-22)
- Updated dependencies [[`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e)]:
    - @posthog/core@1.9.0

## 1.1.5

### Patch Changes

- Updated dependencies [[`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5)]:
    - @posthog/core@1.8.1

## 1.1.4

### Patch Changes

- Updated dependencies [[`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde)]:
    - @posthog/core@1.8.0

## 1.1.3

### Patch Changes

- [#2741](https://github.com/PostHog/posthog-js/pull/2741) [`5c14781`](https://github.com/PostHog/posthog-js/commit/5c14781dc0b791e3fbdc3d9507dc52ccf1eb9ca4) Thanks [@hpouillot](https://github.com/hpouillot)! - fix sourcemap upload with complex file path
  (2025-12-13)

## 1.1.2

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

    We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

    There was no way that any of these vulnerable packages were included in any of our published packages.

    We've now patched out those dependencies.

    Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
    - @posthog/core@1.7.1

## 1.1.1

### Patch Changes

- Updated dependencies [[`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
    - @posthog/core@1.7.0

## 1.1.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
    - @posthog/core@1.6.0

## 1.0.2

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
    - @posthog/core@1.5.6

## 1.0.1

### Patch Changes

- Updated dependencies [[`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f)]:
    - @posthog/core@1.5.5

## 1.0.0

### Major Changes

- [#2587](https://github.com/PostHog/posthog-js/pull/2587) [`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288) Thanks [@hpouillot](https://github.com/hpouillot)! - first version
  (2025-11-20)

### Patch Changes

- Updated dependencies [[`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288)]:
    - @posthog/core@1.5.4
