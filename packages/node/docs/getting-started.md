# Getting started

The Node.js SDK runs on your server, on Node.js 20 or later.

To send your first event, install `posthog-node`, create one client with your project token and host from your [project settings](https://app.posthog.com/project/settings), and call `capture` with a `distinctId` and an event name.

The client queues events and sends them in batches, so call `shutdown` before your process exits, or the last events are lost.

## Install

```bash
npm install posthog-node
```

## Initialize

```ts
import { PostHog } from 'posthog-node'

const client = new PostHog('<ph_project_api_key>', { host: 'https://us.i.posthog.com' })
```

## Capture an event

```ts
client.capture({ distinctId: 'user_123', event: 'signed_up', properties: { plan: 'pro' } })
```

## Shut down

Flush queued events before the process exits.

```ts
await client.shutdown()
```
