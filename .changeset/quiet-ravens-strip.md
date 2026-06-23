---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
'posthog-js-lite': minor
'@posthog/next': minor
---

Add `disable_capture_url_hashes`, disabled by default, to strip URL fragments from automatically captured URLs when explicitly enabled. Setting `disable_capture_url_hashes: true` is a breaking behavior change for SPAs that rely on URL hashes for routing or analytics, because hash-based routes will be collapsed to the same URL without the fragment in fields such as `$current_url`, `$initial_current_url`, `$session_entry_url`, autocapture `$elements[*].attr__href`, `$external_click_url`, replay `href` URLs, heatmaps, web vitals `$current_url`, logs `url.full`, conversations `current_url`/`request_url`, or Next.js Pages Router `$pageview` `$current_url`.

If you only want to capture some hashes, leave hash capture enabled and use `before_send` to remove or redact sensitive hash values before events are sent.
