---
'posthog-js': patch
---

The replayer keeps stylesheet rules inserted through the CSSOM (for example by emotion or MUI) when it applies a large add batch against a detached subtree. Before, a batch of 1,000 or more adds into `<head>` reset those stylesheets, so the rest of the replay rendered unstyled.
