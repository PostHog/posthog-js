# Migrating to the coordinated Electron alpha

This is an opt-in migration from a renderer-only `posthog-js` integration or separate main `posthog-node` and browser clients. It is not a drop-in replacement for either SDK. The alpha is not published by the documentation/release-preparation PR; use a published, reviewed **exact alpha version** only after the [release gates](../../RELEASING.md#electron-alpha-releases) pass.

## 1. Inventory and remove duplicate ownership

- Find every SDK initialization in main, preload, renderers, React providers and helper processes. Record capture, identity, consent, flags, lifecycle, autocapture and exception handlers before changing them.
- Replace the desktop app's independent Node/browser product-analytics clients with **one main-owned Electron client** and renderer facades. Do not retain an old browser `posthog.init()` for DOM autocapture or flags: that creates another identity/session, queue, flag evaluator and potentially duplicate events.
- A genuinely separate backend service may keep its server SDK; do not treat a main-process client as a backend with safe personal API keys or local-evaluation secrets. Desktop binaries must contain public project tokens only.
- Remove old automatic page views, lifecycle capture, flag exposure handlers and global exception listeners where the new integration would duplicate them. Do not enable unsupported replay, surveys or product tours through an old browser client as an implicit part of this migration.

## 2. Install the process boundary explicitly

Follow [setup](./README.md#setup): initialize main once, install the standalone CJS preload (or **bundle** the composition helper into an existing preload), register each trusted window before navigation and initialize the renderer after the bridge is available. Keep `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`.

A sandboxed preload cannot require arbitrary npm dependencies. Keep only `electron` external when bundling the helper. Do not expose raw IPC, remote/untrusted frames, arbitrary channels or filesystem access. Register exact trusted URLs/paths, including custom partitions; registration is not permission for arbitrary future navigation. Main and preload imports must never leak into browser renderer bundles.

## 3. Choose identity and consent continuity deliberately

There is **one account and session for the application**, shared across windows. Concurrent unrelated per-window accounts are unsupported. On authenticated startup, await `identify(accountId)` before dependent captures. On logout, await `reset()` before identifying a different account. Stale renderer work can reject during account changes; do not blindly resubmit it under the next account.

The SDK does not automatically read browser localStorage, scan Chromium profiles/partitions, import a Node queue or migrate old cookies. The default is a new Electron anonymous identity/store. If retaining an existing anonymous identity matters, agree and test an explicit application-owned bootstrap/migration policy before rollout; there is no automatic legacy-store importer. Do not use `identify(oldAnonymousId)` as an undocumented substitute for anonymous-ID migration, or edit the SDK's storage file directly. Use `alias()` only when its identity-merge semantics are actually intended, not to resolve every old window/partition ID automatically.

Carry the user's existing consent into initialization: use `defaultOptIn: false` for a fresh explicit-consent migration, then opt in only after your host has restored the decision. Removing an old SDK must not reset an opt-out to opt-in. Confirm behavior on a fresh install, upgrade, logout, account switch and multiple windows.

Opt-out blocks new analytics, **not delivery of events already accepted while opted in**; in-flight requests may complete. Reset also preserves eligible queued events with their original identities. Identify/local flag context can change and flags can reload while opted out. This is not a data-erasure API or an all-network-off switch. Existing legacy queues are not drained or deleted by this SDK; decide their disposition before removing the old integration without violating consent or duplicating historical events.

## 4. Update asynchronous calls and integrations

```js
import { init } from '@posthog/electron/renderer'

const client = await init()
await client.identify('account-123', { plan: 'pro' })
await client.capture('document_saved', { format: 'pdf' })
await client.reset() // logout; app-wide, not just this window
```

Mutations return promises rather than browser-style synchronous receipts. Await ordering-sensitive operations and handle rejections. A resolved capture is an operation receipt; if admitted, it acknowledges main's completed file write/rename, **not** server delivery or fsync. Consent, filters and queue limits may prevent an event from being admitted. Use `flush()` to attempt pending delivery and handle delivery errors; it does not establish ingestion/query visibility or exactly-once delivery.

For React 18+, replace browser providers with `@posthog/electron/react` and pass `client={initializedRendererClient}`. The provider does not accept a token, initialize another SDK or own disposal. Do not cast the renderer facade to the browser SDK's `PostHog` type. For DOM autocapture, explicitly opt in on renderer initialization; main's remote configuration and consent remain authoritative. Do not assume full browser SDK API parity or automatic page views. Review masking, URL handling and DOM allowlists in the real app.

## 5. Own shutdown and operational recovery

The host controls whether and when the app exits. Await `posthog.shutdown(budgetMs)` in a controlled shutdown path; automatic quit handling is best effort, cannot make Electron await a listener, and never forces quit. Crashes, power loss and OS shutdown can lose uncommitted work. Review queue size/age/storage bounds and `onError`; retries preserve UUIDs but can produce duplicate delivery.

Authenticated proxies are unsupported (`credentials: 'omit'`); retained HTTP 407 batches are a recovery mechanism, not proxy-auth support. Use one application owner per project/host store. If ownership/reclaimer recovery fails closed, stop **all** app/helper processes and back up/investigate the store before any manual coordination-file recovery; never delete locks in a running app. See [storage limits](./README.md#consent-and-storage).

## Rollout checklist

- Validate the **installed registry dependency** path, not just local tarballs that override core. Required core hooks and the browser-common type seam must be available at the declared minimum dependency versions.
- Compare wire identity, consent, session, flag exposure and event counts before/after migration; check offline/restart and account-switch behavior without mixing old/new clients.
- Validate packaged/ASAR standalone and composed preloads on every supported OS/runtime. Only macOS local runtime evidence exists so far; Windows/Linux CI and published harness acceptance are not claimed green here.
- Roll out to an internal/small alpha cohort first. Rollback is an application deployment decision, not automatic conversion of the Electron store back into browser/Node storage. Keep consent intact on rollback and prevent both implementations from capturing simultaneously.
