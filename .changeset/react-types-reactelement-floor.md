---
'@posthog/react': patch
'posthog-js': patch
---

Type declarations no longer import the `JSX` namespace from `react`, so they typecheck against `@types/react` back to 16.9.0. Component return types are now `ReactElement` instead of `JSX.Element` — structurally the same type, since `JSX.Element` is declared as `ReactElement<any, any>`.

`JSX` only became an exported member of the `react` types module in `@types/react@18.2.6`, so projects on older React types previously saw `TS2305: Module '"react"' has no exported member 'JSX'` when checking these declarations with `skipLibCheck: false`. The `@types/react` peer range is corrected to `>=16.9.0` to match — 16.9.0 is where `ReactElement`'s first type parameter gained its `any` default.
