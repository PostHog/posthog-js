---
'posthog-js': patch
'@posthog/types': patch
---

fix(browser): refresh feature flags when a hidden tab becomes visible again

A long-lived background tab skipped every periodic flag refresh, because
`refresh()` returns early while the tab is hidden and nothing re-ran it when the
tab came back. The tab then served the cached flag value until the next interval
tick, which browsers throttle hard for background tabs. A `visibilitychange`
listener now refreshes flags when the tab becomes visible again, guarded by a
minimum interval so restored tabs do not stampede `/flags`. The refresh interval
also starts when the remote-config load fails, so a tab that lost that request
still polls for later flag changes.
