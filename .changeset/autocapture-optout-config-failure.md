---
'posthog-js': patch
---

fix: honour the project-level autocapture opt-out when the remote config request fails. Previously a failed config fetch (network error, timeout, blocked request) enabled autocapture on opted-out projects and persisted that state for later page loads. Autocapture now keeps the last successfully received server value, and stays off until the first successful config response.
