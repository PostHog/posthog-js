---
'posthog-js': minor
'@posthog/types': minor
'@posthog/core': minor
---

Add a `beforeSend` option to the logs config, so you can inspect, redact, or drop log records before they're sent:

```js
posthog.init('<token>', {
    logs: {
        beforeSend: (log) => {
            // return null to drop the log, or return the (optionally modified) log to keep it
            if (log.body.includes('password')) {
                return null
            }
            return log
        },
    },
})
```

`beforeSend` accepts a single function or an array of functions (applied left to right); returning `null` from any of them drops the record. It runs for logs sent via both `posthog.captureLog()` and `posthog.logger.*`.

This release also makes log delivery more resilient: oversized batches are split automatically, failed sends retry with exponential backoff, and delivery resumes when the browser comes back online.
