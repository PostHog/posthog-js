# Vue 3 + TypeScript + Vite

Commands to test sourcemap upload:
```shell
// Generate build artifacts and use posthog-cli to inject snippets into sources and sourcemaps
VITE_POSTHOG_KEY='<your-local-api-key>' VITE_POSTHOG_HOST='http://localhost:8010' pnpm run build

// Use posthog-cli to inject snippets into sources and sourcemaps
pnpm run inject

// Run application locally with newly generated minified build and sourcemaps
pnpm run preview

// Upload sourcemaps to PostHog
pnpm run upload
```
