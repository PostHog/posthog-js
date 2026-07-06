---
'@posthog/next': patch
---

Dedupe `getDistinctId` resolution per request in the App Router: repeated `getPostHog()` calls within one request (e.g. across a layout and its pages) now share a single resolver invocation, keyed on the request's `headers()` instance.
