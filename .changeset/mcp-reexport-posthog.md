---
'@posthog/mcp': patch
---

Re-export `PostHog` (and the `PostHogOptions` type) from `@posthog/mcp`, so you can import the client and `instrument` from a single package:

```ts
import { PostHog, instrument } from "@posthog/mcp"
```

`posthog-node` remains a peer dependency (resolved from the host app's installed copy); this only unifies the import. `PostHogMCP` is also already accepted by `instrument()` if you prefer a single client class.
