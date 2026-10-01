---
'@posthog/mcp': patch
---

Sanitize only the part of a long string that the captured event can keep, so a tool call returning megabytes of HTML or text no longer blocks the event loop while it is scanned. A 10 MB HTML response now costs about 2 ms to capture instead of 2.7 s. The captured event does not change.
