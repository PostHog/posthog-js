# Getting started

The JavaScript Web SDK runs in the browser.

To send your first event, install `posthog-js`, then call `posthog.init` once with your project token and host from your [project settings](https://app.posthog.com/project/settings).

After `init`, PostHog captures pageviews and clicks by itself, so loading a page sends your first event to the Activity page in PostHog. Use `capture` for your own events.

For server-side JavaScript, use the Node.js SDK.

## Install

```bash
npm install posthog-js
```

## Initialize

```ts
import posthog from 'posthog-js'

posthog.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })
```

## Capture an event

```ts
posthog.capture('signed_up', { plan: 'pro' })
```

## Identify a user

```ts
posthog.identify('user_123', { email: 'user@example.com' })
```
