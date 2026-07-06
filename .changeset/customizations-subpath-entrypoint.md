---
"posthog-js": minor
---

feat(web): add a `posthog-js/customizations` subpath entry point exposing the optional customizations (`setAllPersonProfilePropertiesAsPersonPropertiesForFlags`, the `before-send` sampling helpers, and the redux/kea loggers) as a proper ES module with bundled types, replacing the internal `posthog-js/lib/src/customizations` deep import. Also fixes the TypeScript definitions so `setAllPersonProfilePropertiesAsPersonPropertiesForFlags` accepts the instance passed to the `loaded` callback (the documented usage), and the `loaded` callback's instance type now includes `config`.
