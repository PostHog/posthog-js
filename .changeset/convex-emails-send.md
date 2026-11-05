---
'@posthog/convex': minor
---

Send email your code rendered with `posthog.sendEmail(ctx, email)`, or queue it on your Workpool with `posthog.enqueueEmail(ctx, pool, email)`. Set `POSTHOG_SECRET_KEY` to a project secret key with the `transactional_email:write` scope. A queued send makes its idempotency key when you enqueue it, so Workpool retries a retryable failure with the same key and stops on a permanent one. A failed send throws a `ConvexError` whose `data` holds the error's `code`, `status` and `retryable` fields.
