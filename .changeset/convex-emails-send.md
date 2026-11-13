---
'@posthog/convex': minor
---

Send email your code rendered with `posthog.sendEmail(ctx, email)`, or queue it on your Workpool with `posthog.enqueueEmail(ctx, pool, email)`. Set `POSTHOG_SECRET_KEY` to a project secret key with the `transactional_email:write` scope, and `POSTHOG_APP_HOST` when `POSTHOG_HOST` is a self-hosted instance or a proxy. `tracking` and `sensitive` set what PostHog tracks for each email. A queued send makes its idempotency key when you enqueue it, so Workpool retries a retryable failure with the same key and stops on a permanent one; when PostHog asks it to wait, the attempt waits it out first, and a wait that ends more than five minutes after the attempt began stops the job without sending early. A failed send throws a `ConvexError` whose `data` holds the error's `code`, `status`, `retryable` and `retry_after` fields.
