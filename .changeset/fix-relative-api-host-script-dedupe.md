---
'posthog-js': patch
---

Stop adding PostHog's optional feature scripts, such as the session replay recorder and exception autocapture, to the page more than once. Sites that proxy PostHog through their own domain, by setting `api_host` to a path like `/ingest` rather than a full URL, ended up with the same `<script>` tag three or four times: the check meant to spot the duplicate compared the browser's resolved absolute URL against the relative one, so it never matched. The network tab showed a single request either way, because the browser served the repeats from its cache, which is why this was easy to miss. Nothing measurable got slower as a result, so this is a correctness fix rather than a speed one.
