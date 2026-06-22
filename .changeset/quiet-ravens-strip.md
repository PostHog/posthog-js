---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
'posthog-js-lite': minor
'@posthog/next': minor
---

Add `disable_capture_url_hashes`, enabled by default, to strip URL fragments from automatically captured URLs. This can be a behavior change for projects that previously relied on hashes being captured in URL fields such as `$current_url`, `$initial_current_url`, `$session_entry_url`, replay URLs, heatmaps, web vitals, logs, conversations, or Next.js Pages Router pageviews.

To keep capturing hashes, set `disable_capture_url_hashes: false`. If you only want to capture some hashes, leave hash capture enabled and use `before_send` to remove or redact sensitive hash values before events are sent.
