# Next.js + TypeScript + App Router

Commands to test sourcemap upload:
```shell
# Generate build artifacts and use posthog-cli to inject snippets into sources and sourcemaps
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8010' pnpm run build

# Use posthog-cli to inject snippets into sources and sourcemaps
pnpm run inject

# Run application locally with newly generated minified build and sourcemaps
pnpm run start

# Upload sourcemaps to PostHog. Make sure you are logged in with posthog-cli before.
pnpm run upload
```
