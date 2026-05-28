---
'@posthog/core': patch
---

Avoid leaking DOM-only globals (`ErrorEvent`, `PromiseRejectionEvent`, `Event`) into `@posthog/core`'s public type surface by typing the relevant coercers with structural subsets. Fixes `generate-references` failing in `posthog-react-native` whose tsconfig `lib` excludes DOM.
