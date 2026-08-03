---
'posthog-js': patch
---

Avoid promoting handled transport failures to error logs in surveys, product tours, remote config, conversations, and logs while preserving error severity for HTTP and unexpected failures.
