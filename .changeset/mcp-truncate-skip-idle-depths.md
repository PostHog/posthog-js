---
'@posthog/mcp': patch
---

Make oversized events cheaper to truncate. The depth reduction now starts at the first depth that removes anything, so shallow payloads such as rows of data no longer normalize and measure the whole event again for each depth that changes nothing.
