---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/browser': patch
---

A `$feature_flag_called` event that the client rate limit drops is now sent again at the next capture. Before, the flag was marked as reported and its exposure was lost.
