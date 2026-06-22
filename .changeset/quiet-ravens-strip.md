---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
'posthog-js-lite': minor
'@posthog/next': minor
---

Add `disable_capture_url_hashes`, enabled by default, to strip URL fragments from automatically captured URLs. This is a breaking behavior change for SPAs that rely on URL hashes for routing or analytics, because hash-based routes will now be collapsed to the same URL without the fragment in fields such as `$current_url`, `$initial_current_url`, `$session_entry_url`, replay URLs, heatmaps, web vitals, logs, conversations, or Next.js Pages Router pageviews.

To keep capturing hash-based SPA routes, set `disable_capture_url_hashes: false`. If you only want to capture some hashes, leave hash capture enabled and use `before_send` to remove or redact sensitive hash values before events are sent.
