---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
'posthog-js-lite': minor
'@posthog/next': minor
---

Add `disable_capture_url_hashes` to strip URL fragments from automatically captured URLs. It is disabled by default for backwards compatibility, and enabled automatically when `config.defaults` is `'2026-06-25'` or later. Enabling it (either explicitly or via the `'2026-06-25'` defaults) is a breaking behavior change for SPAs that rely on URL hashes for routing or analytics, because hash-based routes will be collapsed to the same URL without the fragment in fields such as `$current_url`, `$initial_current_url`, `$session_entry_url`, autocapture `$elements[*].attr__href`, `$external_click_url`, replay `href` URLs, heatmaps, web vitals `$current_url`, logs `url.full`, conversations `current_url`/`request_url`, or Next.js Pages Router `$pageview` `$current_url`.

If you only want to capture some hashes, leave hash capture enabled and use `before_send` to remove or redact sensitive hash values before events are sent.
