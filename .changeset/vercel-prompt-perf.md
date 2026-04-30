---
'@posthog/ai': patch
---

perf(vercel): drop O(N²) prompt trim and reuse TextEncoder/TextDecoder in `mapVercelPrompt`/`truncate` so long conversations no longer block the main thread for hundreds of milliseconds in `withTracing`'s stream flush
