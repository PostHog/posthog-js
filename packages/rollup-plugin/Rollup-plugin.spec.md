# Rollup-plugin

@posthog/rollup-plugin: Rollup and Vite plugin that uploads sourcemaps.

## entrances

- rollup plugin: the customer's Rollup or Vite build runs the plugin, which calls the PostHog CLI to upload sourcemaps
  handler: posthogRollupPlugin in src/index.ts
  trust: build

## invariants
