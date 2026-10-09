# Node

posthog-node, the Node.js backend SDK: server-side capture, identify and local feature flag evaluation.

## entrances

- public api: the server app calls capture, identify, flag evaluation and shutdown on posthog-node
  handler: PostHog in src/entrypoints/index.node.ts
  trust: host-app
- flag definitions: PostHog servers answer the poller with the flag definitions used for local evaluation
  handler: FeatureFlagsPoller in src/extensions/feature-flags/feature-flags.ts
  trust: posthog-api

## invariants
