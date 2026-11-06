# Getting started

## Install

```bash
npm install posthog-js
```

## Initialize

```ts
import posthog from 'posthog-js'

posthog.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })
```

## Capture

```ts
posthog.capture('signed_up', { plan: 'pro' })
```

## Identify

```ts
posthog.identify('user_123', { email: 'user@example.com' })
```
