---
'@posthog/nextjs-config': patch
---

Strip dangling `//# sourceMappingURL=` comments from Turbopack browser chunks when `deleteAfterUpload` is set, so deleted source maps are no longer referenced (and 404) in production.
