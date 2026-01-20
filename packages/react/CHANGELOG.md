# @posthog/react

## 1.6.0

### Minor Changes

- [#2900](https://github.com/PostHog/posthog-js/pull/2900) [`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11) Thanks [@dmarticus](https://github.com/dmarticus)! - Renamed `evaluationEnvironments` to `evaluationContexts` for clearer semantics. The term "contexts" better reflects that this feature is for specifying evaluation contexts (e.g., "web", "mobile", "checkout") rather than deployment environments (e.g., "staging", "production").

    ### Deprecated
    - `posthog.init` option `evaluationEnvironments` is now deprecated in favor of `evaluationContexts`. The old property will continue to work and will log a deprecation warning. It will be removed in a future major version.

    ### Migration Guide

    ````javascript
    // Before
    posthog.init('<ph_project_api_key>', {
        evaluationEnvironments: ['production', 'web', 'checkout'],
    })

    // After
    posthog.init('<ph_project_api_key>', {
        evaluationContexts: ['production', 'web', 'checkout'],
    })
    ``` (2026-01-19)
    ````

### Patch Changes

- Updated dependencies [[`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11)]:
    - posthog-js@1.331.0

## 1.5.2

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

    We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

    There was no way that any of these vulnerable packages were included in any of our published packages.

    We've now patched out those dependencies.

    Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
    - posthog-js@1.301.2

## 1.5.1

### Patch Changes

- [#2655](https://github.com/PostHog/posthog-js/pull/2655) [`d10783f`](https://github.com/PostHog/posthog-js/commit/d10783fb472bdc3a74994a7b74504b525ef725a3) Thanks [@ordehi](https://github.com/ordehi)! - Updated feature flag hooks to properly check if client is initialized and prevent client is undefined errors
  (2025-12-03)
- Updated dependencies [[`4487d6b`](https://github.com/PostHog/posthog-js/commit/4487d6b28e4f76696f13cea5d08dfceda3aa2cd9), [`0e67750`](https://github.com/PostHog/posthog-js/commit/0e6775030aa43d24588f2e6dbe624e8d8a1f6d7c), [`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
    - posthog-js@1.300.0

## 1.5.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
    - posthog-js@1.298.0

## 1.4.1

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
    - posthog-js@1.297.3

## 1.4.0

### Minor Changes

- [#2551](https://github.com/PostHog/posthog-js/pull/2551) [`10be1b0`](https://github.com/PostHog/posthog-js/commit/10be1b071ab30da45749b91cfdeff913912e7bbb) Thanks [@dmarticus](https://github.com/dmarticus)! - Support bootstrapping feature flags during SSR in ReactJS

### Patch Changes

- Updated dependencies [[`10be1b0`](https://github.com/PostHog/posthog-js/commit/10be1b071ab30da45749b91cfdeff913912e7bbb)]:
    - posthog-js@1.289.0

## 1.3.0

### Minor Changes

- [#2517](https://github.com/PostHog/posthog-js/pull/2517) [`46e3ca6`](https://github.com/PostHog/posthog-js/commit/46e3ca600ca478db1b319b36695dea090aa60f98) Thanks [@pauldambra](https://github.com/pauldambra)! - feat: add a component that will wrap your components and capture an event when they are in view in the browser

### Patch Changes

- [#2517](https://github.com/PostHog/posthog-js/pull/2517) [`46e3ca6`](https://github.com/PostHog/posthog-js/commit/46e3ca600ca478db1b319b36695dea090aa60f98) Thanks [@pauldambra](https://github.com/pauldambra)! - fix: complete react sdk featureflag component refactor

- Updated dependencies [[`46e3ca6`](https://github.com/PostHog/posthog-js/commit/46e3ca600ca478db1b319b36695dea090aa60f98), [`46e3ca6`](https://github.com/PostHog/posthog-js/commit/46e3ca600ca478db1b319b36695dea090aa60f98)]:
    - posthog-js@1.282.0

## 1.2.3

### Patch Changes

- [#2390](https://github.com/PostHog/posthog-js/pull/2390) [`244b3ad`](https://github.com/PostHog/posthog-js/commit/244b3ad2f6dea8086747046044245b1514bd658b) Thanks [@hpouillot](https://github.com/hpouillot)! - fix react sourcemaps

- Updated dependencies [[`244b3ad`](https://github.com/PostHog/posthog-js/commit/244b3ad2f6dea8086747046044245b1514bd658b)]:
    - posthog-js@1.270.1

## 1.2.2

### Patch Changes

- [#2389](https://github.com/PostHog/posthog-js/pull/2389) [`ac17e4a`](https://github.com/PostHog/posthog-js/commit/ac17e4a61ddc7e71178daadfb1d9284fd574f4a4) Thanks [@pauldambra](https://github.com/pauldambra)! - revert: "fix(react): fix react sourcemaps"

## 1.2.1

### Patch Changes

- [#2374](https://github.com/PostHog/posthog-js/pull/2374) [`5af6e2d`](https://github.com/PostHog/posthog-js/commit/5af6e2d1fb1694cecfa4ef515cac192fb194fa4e) Thanks [@hpouillot](https://github.com/hpouillot)! - fix react sourcemaps

- Updated dependencies [[`5af6e2d`](https://github.com/PostHog/posthog-js/commit/5af6e2d1fb1694cecfa4ef515cac192fb194fa4e)]:
    - posthog-js@1.268.10

## 1.2.0

### Minor Changes

- [#2300](https://github.com/PostHog/posthog-js/pull/2300) [`e4a147c`](https://github.com/PostHog/posthog-js/commit/e4a147c86553765d299fb0969bfd390e5aabc952) Thanks [@daibhin](https://github.com/daibhin)! - feat: added helper method for React 19 error callbacks

## 1.1.0

### Minor Changes

- [#2200](https://github.com/PostHog/posthog-js/pull/2200) [`4387da4`](https://github.com/PostHog/posthog-js/commit/4387da42148a6b96c7bf1f9f5a2c529a3eb4dd8a) Thanks [@daibhin](https://github.com/daibhin)! - expose captured exception to error boundary fallback

### Patch Changes

- Updated dependencies [[`4387da4`](https://github.com/PostHog/posthog-js/commit/4387da42148a6b96c7bf1f9f5a2c529a3eb4dd8a), [`fda2932`](https://github.com/PostHog/posthog-js/commit/fda2932d0c4835d205fe0e0d0efb724b964f9f9b)]:
    - posthog-js@1.260.0
