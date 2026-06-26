# @posthog/openfeature-node

> **Status: not yet published.** This package is marked `private` and is not released to npm. It lives
> in the monorepo and builds in CI while the API is finalized. The install snippet below describes the
> intended usage once it ships.

Official [PostHog](https://posthog.com) provider for the [OpenFeature](https://openfeature.dev) **server**
SDK ([`@openfeature/server-sdk`](https://openfeature.dev/docs/reference/technologies/server/javascript)),
backed by [`posthog-node`](https://posthog.com/docs/libraries/node). For the browser, use
[`@posthog/openfeature-web`](../openfeature-web).

The server model is async and multi-user: the distinct id arrives per evaluation (from the context's
`targetingKey`) and resolution returns a promise.

```bash
pnpm add @posthog/openfeature-node @openfeature/server-sdk posthog-node
```

```ts
import { OpenFeature } from '@openfeature/server-sdk'
import { PostHogServerProvider } from '@posthog/openfeature-node'
import { PostHog } from 'posthog-node'

// You own the PostHog client lifecycle. Pass a personalApiKey to enable local evaluation.
const posthog = new PostHog('<PROJECT_API_KEY>', { host: 'https://us.i.posthog.com' })

await OpenFeature.setProviderAndWait(new PostHogServerProvider(posthog))
const client = OpenFeature.getClient()

// The distinct id comes from the evaluation context's targetingKey.
const enabled = await client.getBooleanValue('my-flag', false, { targetingKey: 'user_123' })
```

## Evaluation context mapping

| Context attribute   | PostHog                    |
| ------------------- | -------------------------- |
| `targetingKey`      | `distinctId`               |
| `groups`            | PostHog `groups`           |
| `groupProperties`   | PostHog `groupProperties`  |
| any other attribute | PostHog `personProperties` |

## Flag-type mapping

| OpenFeature evaluation | PostHog `getFeatureFlagResult` field |
| ---------------------- | ------------------------------------ |
| boolean                | `enabled`                            |
| string                 | the multivariate `variant`           |
| number                 | `variant` parsed as a number         |
| object                 | the flag's JSON `payload`            |

A non-existent flag resolves to the OpenFeature `FLAG_NOT_FOUND` error (so callers get their default
value), and asking for a type the flag can't provide (e.g. a string from a boolean flag) resolves to
`TYPE_MISMATCH`.

## Options

- `sendFeatureFlagEvents` (default `true`) — control `$feature_flag_called` capture.
- `defaultDistinctId` — when set, evaluations without a `targetingKey` use it instead of raising
  `TARGETING_KEY_MISSING`.
