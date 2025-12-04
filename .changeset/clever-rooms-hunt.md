---
'@posthog/ai': patch
'posthog-js': patch
'@posthog/core': patch
'@posthog/nextjs-config': patch
'posthog-node': patch
'@posthog/nuxt': patch
'@posthog/react': patch
'posthog-react-native': patch
'@posthog/rollup-plugin': patch
'posthog-js-lite': patch
'@posthog/webpack-plugin': patch
'@posthog-tooling/rollup-utils': patch
'@posthog-tooling/tsconfig-base': patch
---

Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

There was no way that any of these vulnerable packages were included in any of our published packages.

We've now patched out those dependencies.

Out of an abundance of caution, let's create a new release of all of our packages.
