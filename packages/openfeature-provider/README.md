# @posthog/openfeature-provider

Official [PostHog](https://posthog.com) providers for the [OpenFeature](https://openfeature.dev) SDK.

OpenFeature ships two SDKs with deliberately different provider contracts, so this package ships one
provider for each — sharing the same flag-to-OpenFeature value mapping:

| Subpath                                  | OpenFeature SDK            | PostHog client | Model                          |
| ---------------------------------------- | -------------------------- | -------------- | ------------------------------ |
| `@posthog/openfeature-provider/server`   | `@openfeature/server-sdk`  | `posthog-node` | async, multi-user, per-call id |
| `@posthog/openfeature-provider/web`      | `@openfeature/web-sdk`     | `posthog-js`   | synchronous, single-user       |

Install the package alongside the SDK and PostHog client for your runtime — you only need the two that
match your paradigm:

```bash
# Server / Node
pnpm add @posthog/openfeature-provider @openfeature/server-sdk posthog-node

# Browser / Web
pnpm add @posthog/openfeature-provider @openfeature/web-sdk posthog-js
```

## Server (Node)

```ts
import { OpenFeature } from '@openfeature/server-sdk'
import { PostHogServerProvider } from '@posthog/openfeature-provider/server'
import { PostHog } from 'posthog-node'

// You own the PostHog client lifecycle. Pass a personalApiKey to enable local evaluation.
const posthog = new PostHog('<PROJECT_API_KEY>', { host: 'https://us.i.posthog.com' })

await OpenFeature.setProviderAndWait(new PostHogServerProvider(posthog))
const client = OpenFeature.getClient()

// The distinct id comes from the evaluation context's targetingKey.
const enabled = await client.getBooleanValue('my-flag', false, { targetingKey: 'user_123' })
```

## Web (Browser)

```ts
import { OpenFeature } from '@openfeature/web-sdk'
import { PostHogWebProvider } from '@posthog/openfeature-provider/web'
import posthog from 'posthog-js'

posthog.init('<PROJECT_API_KEY>', { api_host: 'https://us.i.posthog.com' })

await OpenFeature.setProviderAndWait(new PostHogWebProvider(posthog))
const client = OpenFeature.getClient()

// posthog-js owns the user identity (posthog.identify(...)). Evaluation is synchronous.
const enabled = client.getBooleanValue('my-flag', false)
```

## Evaluation context mapping

Both providers map the OpenFeature evaluation context to PostHog the same way:

| Context attribute        | PostHog                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `targetingKey`           | `distinctId` (server only — the browser owns identity)     |
| `groups`                 | PostHog `groups`                                           |
| `groupProperties`        | PostHog `groupProperties`                                  |
| any other attribute      | PostHog `personProperties`                                 |

In the browser, the context is reconciled into `posthog-js` on `initialize`/`onContextChange`
(person properties via `setPersonPropertiesForFlags`, groups via `group`), then flags are reloaded.
The web provider never calls `identify()` — manage the user identity through `posthog-js` as usual.

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

Both providers accept `sendFeatureFlagEvents` (default `true`) to control `$feature_flag_called`
capture. The server provider additionally accepts `defaultDistinctId` — when set, evaluations without a
`targetingKey` use it instead of raising `TARGETING_KEY_MISSING`. The web provider additionally accepts
`reloadTimeoutMs` (default `5000`) — the maximum time `initialize`/`onContextChange` waits for
`posthog-js` to (re)load flags before becoming ready anyway, so the OpenFeature client can't get stuck
NOT_READY if the SDK never delivers its flags callback.
