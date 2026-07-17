---
'posthog-js': patch
---

Shrink bundle sizes through build tuning: enable terser's `unsafe_arrows` and a third compress pass, and align rollup tree-shaking purity assumptions with terser's existing `pure_getters` posture
