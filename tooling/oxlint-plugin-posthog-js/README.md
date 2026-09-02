# PostHog JS custom Oxlint rules

This package contains custom Oxlint rules for the PostHog JavaScript codebase.

For example, PostHog provides type-checking helpers such as `isNull` and `isBoolean`. They keep the browser bundle small, so these rules prevent direct type checks from being introduced accidentally.

The plugin is loaded by the root `.oxlintrc.json` through Oxlint's JavaScript plugin API. Run its rule tests with:

```bash
pnpm --filter oxlint-plugin-posthog-js test:unit
```
