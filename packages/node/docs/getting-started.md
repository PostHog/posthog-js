# Getting started

## Install

```bash
npm install posthog-node
```

## Initialize

```ts
import { PostHog } from 'posthog-node'

const client = new PostHog('<ph_project_api_key>', { host: 'https://us.i.posthog.com' })
```

## Capture

```ts
client.capture({ distinctId: 'user_123', event: 'signed_up', properties: { plan: 'pro' } })
```

## Shut down

Flush queued events before the process exits.

```ts
await client.shutdown()
```
