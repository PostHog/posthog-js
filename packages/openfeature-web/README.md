# @posthog/openfeature-web

> **Status: not yet published.** This package is marked `private` and is not released to npm. It lives
> in the monorepo and builds in CI while the API is finalized. The install snippet below describes the
> intended usage once it ships.

Official [PostHog](https://posthog.com) provider for the [OpenFeature](https://openfeature.dev) **web**
SDK ([`@openfeature/web-sdk`](https://openfeature.dev/docs/reference/technologies/client/web)), backed by
[`posthog-js`](https://posthog.com/docs/libraries/js). For the server, use
[`@posthog/openfeature-node`](../openfeature-node).

The browser model is single-user and synchronous: `posthog-js` owns the user identity and keeps flags in
memory, so evaluation is synchronous and the static evaluation context is reconciled into the SDK
whenever it changes (the OpenFeature `onContextChange` contract).

```bash
pnpm add @posthog/openfeature-web @openfeature/web-sdk posthog-js
```

```ts
import { OpenFeature } from '@openfeature/web-sdk'
import { PostHogWebProvider } from '@posthog/openfeature-web'
import posthog from 'posthog-js'

posthog.init('<PROJECT_API_KEY>', { api_host: 'https://us.i.posthog.com' })

await OpenFeature.setProviderAndWait(new PostHogWebProvider(posthog))
const client = OpenFeature.getClient()

// posthog-js owns the user identity (posthog.identify(...)). Evaluation is synchronous.
const enabled = client.getBooleanValue('my-flag', false)
```

## Evaluation context mapping

| Context attribute   | PostHog                                     |
| ------------------- | ------------------------------------------- |
| `groups`            | `posthog.group(type, key)`                  |
| `groupProperties`   | `posthog.group(type, key, properties)`      |
| any other attribute | `posthog.setPersonPropertiesForFlags(...)`  |

The context is reconciled into `posthog-js` on `initialize`/`onContextChange`, then flags are reloaded.
The web provider never calls `identify()` — manage the user identity through `posthog-js` as usual, so
`targetingKey` is not used to switch users.

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
- `reloadTimeoutMs` (default `5000`) — the maximum time `initialize`/`onContextChange` waits for
  `posthog-js` to (re)load flags before becoming ready anyway, so the OpenFeature client can't get stuck
  NOT_READY if the SDK never delivers its flags callback.
