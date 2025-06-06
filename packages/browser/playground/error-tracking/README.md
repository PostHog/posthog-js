# Getting started

### Requirements

```shell
# Install PostHog CLI globally
cargo install posthog-cli
```

From the project root directory:
```shell
# Install deps
pnpm install

# Build local version of posthog-js
pnpm run build-posthog
```

## Sourcemaps management

Commands to test sourcemap upload:
```shell
# Generate build artifacts and use posthog-cli to inject snippets into sources and sourcemaps
VITE_POSTHOG_KEY='<your-project-key>' VITE_POSTHOG_HOST='http://localhost:8010' pnpm run build

# For NextJS based app use
NEXT_PUBLIC_POSTHOG_KEY='<your-project-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8010' pnpm run build

# Use posthog-cli to inject snippets into sources and sourcemaps
pnpm run inject

# Upload sourcemaps to PostHog
pnpm run upload

# Run application locally with newly generated minified build and sourcemaps
# Start sending exceptions to PostHog
pnpm run preview
```
