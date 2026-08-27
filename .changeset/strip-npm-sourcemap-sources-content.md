---
'posthog-js': patch
---

Drop `sourcesContent` from the source maps published to npm. The maps themselves still ship, so downstream source-map chaining and the `//# sourceMappingURL` references are unaffected — only the copy of our TypeScript sources embedded in each map is gone, taking the package from 40.8 MB to 17.4 MB unpacked. CDN artifacts are built separately and keep their inlined sources.
