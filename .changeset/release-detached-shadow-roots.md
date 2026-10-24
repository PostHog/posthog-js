---
'posthog-js': patch
---

Session replay releases a removed shadow DOM host as soon as it leaves the page, instead of keeping it and its detached subtree in memory until the next full snapshot.
