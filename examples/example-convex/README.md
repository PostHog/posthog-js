# Example app — `@posthog/convex`

Exercises every method the component exposes — analytics, local feature flag eval, remote feature
flag eval, and AI generation tracing — against a real PostHog project. Useful for verifying
changes to the component end-to-end and as a runnable reference for setup.

## Running it

From the repository root:

```sh
pnpm i
pnpm package        # builds the tarball that this app installs
pnpm dev --filter example-convex
```

In a second terminal:

```sh
cd examples/example-convex
npx convex dev
npx convex env set POSTHOG_API_KEY phc_…           # project key
npx convex env set POSTHOG_PERSONAL_API_KEY phs_…  # optional, enables local eval
npx convex env set POSTHOG_HOST https://us.i.posthog.com   # optional, US default
```

## What you'll see

- **Sections 01–05** capture analytics events (verify them in your PostHog activity feed).
- **Section 06** has two rows of buttons — local-eval methods (query context, reactive) and
  remote-eval methods (action context, per-call `/flags` request).
- **Section 07** captures `$ai_generation` events through `@posthog/ai` using three different
  tracing approaches. See [LLM analytics for Convex](https://posthog.com/docs/llm-analytics/installation/convex).
- The right column shows the local evaluation cache state plus a live, reactive view of flag
  values for the current Distinct ID — change a flag in PostHog and the row flashes when the cron
  picks it up.
