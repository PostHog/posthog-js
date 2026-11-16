# Nextjs-config

@posthog/nextjs-config, a Next.js config helper that uploads sourcemaps at build time.

## entrances

- next config: the customer's next.config wraps its config so the build uploads sourcemaps
  handler: withPostHogConfig in src/config.ts
  trust: build

## invariants
