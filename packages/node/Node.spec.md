# Node

posthog-node, the Node.js backend SDK: server-side capture, identify and local feature flag evaluation.

## entrances

- public api: the server app calls capture, identify, flag evaluation and shutdown on posthog-node
  handler: PostHog in src/entrypoints/index.node.ts
  trust: host-app
- flag definitions: PostHog servers answer the poller with the flag definitions used for local evaluation
  handler: FeatureFlagsPoller in src/extensions/feature-flags/feature-flags.ts
  trust: posthog-api
- flags responses: PostHog servers answer `/flags?v=4` with each flag's typed value, reason and rule metadata, or with the older record when they do not serve v4
  handler: readFlagRecords in src/flags-response.ts
  trust: posthog-api
  control: none — a record with a known field of the wrong JSON type reads as a disabled flag and leaves the other flags readable
- email responses: PostHog servers answer `emails.send` with a queued message ID or an error, and `emails.get` with an email's status or an error
  handler: EmailSender in src/emails/emails.ts
  trust: posthog-api
  control: none — the reply only fills the result the caller awaits, and its one effect, a retry, is bounded by maxRetries and a 30 second ceiling

## invariants
