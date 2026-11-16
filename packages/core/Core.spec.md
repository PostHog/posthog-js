# Core

Shared, platform-neutral core every JS SDK builds on: the capture queue, flags, persistence contracts and the HTTP client.

## entrances

- core api: an SDK built on core calls capture, identify, flags and flush on the shared client
  handler: PostHogCoreStateless in src/posthog-core-stateless.ts
  trust: host-app

## invariants
