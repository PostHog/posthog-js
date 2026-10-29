# Webpack-plugin

@posthog/webpack-plugin: webpack plugin that uploads sourcemaps.

## entrances

- webpack plugin: the customer's webpack build runs the plugin, which calls the PostHog CLI to upload sourcemaps
  handler: PosthogWebpackPlugin in src/index.ts
  trust: build

## invariants
