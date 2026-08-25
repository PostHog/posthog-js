---
'@posthog/react': patch
'posthog-js': patch
---

Type declarations no longer import the `JSX` namespace from `react`, so they typecheck against `@types/react` back to the declared 16.8.0 floor. Component return types are now spelled `ReactElement<any, any>`, which is the definition of `JSX.Element` — the same type, so consuming code is unaffected.

`JSX` only became an exported member of the `react` types module in `@types/react@18.2.6`, so projects on older React types previously saw `TS2305: Module '"react"' has no exported member 'JSX'` when checking these declarations with `skipLibCheck: false`.
