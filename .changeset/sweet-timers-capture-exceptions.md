---
"@posthog/next": minor
---

Enable exception capture by default.

- Client-side PostHog initialization now sets `capture_exceptions: true` by default. Pass `clientOptions.capture_exceptions` to override this.
- Apps can export `onRequestError` from `@posthog/next` in `instrumentation.ts` to capture server-side request errors handled by Next.js, including in the Edge runtime.
- Alternatively, import `captureRequestError` and call it from `onRequestError`.
