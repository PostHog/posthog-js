# Electron delivery tests

These loopback-only tests launch **real Electron main processes** against the built SDK.
They do not use PostHog projects or disable TLS verification. Install dependencies without
lifecycle scripts, then explicitly download the pinned Electron test binary:

```sh
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
pnpm install --filter @posthog/electron... --frozen-lockfile --ignore-scripts
pnpm --filter @posthog/electron exec node node_modules/electron/install.js
pnpm turbo run build --filter=@posthog/electron
pnpm --filter @posthog/electron test:delivery
```

A graphical Electron environment is required (Linux runners need their normal Xvfb setup).
The TLS rejection test uses local `openssl` to generate a one-day self-signed certificate.
Fixtures use temporary user-data/storage directories; teardown kills child processes before
removing their files. No dependency install/download is performed by the tests.

Coverage:

- Refused loopback connection, persisted anonymous/identified events, SIGKILL, same-store
  restart and recovery with the **original persisted UUIDs and identities**.
- Simultaneous real processes: active owner denies an inactive second client, including
  attempted opt-in, identify, capture, flag loading and flush; abrupt owner death and two
  competing reclaimers; normal release; explicit independent storage directories.
- 429 Retry-After backpressure, bounded queue during repeated capture/flush, interrupted
  shutdown, and expiry after an eight-day outage modeled by aging a stopped fixture's file.
- Real Chromium HTTP proxy routing. Authenticated HTTP proxy challenges remain **unsupported**:
  407 retains the queue, and changing the fixture proxy configuration plus restarting recovers
  the original UUID. The fixture's host login callback deliberately cannot bypass `credentials: omit`.
- HTTPS CONNECT routing and rejection of an untrusted certificate, without global TLS flags
  or certificate-error overrides. Trusted enterprise CA/proxy authentication success is not
  claimed or covered.
- Deferred filesystem ownership acquisition while shutdown times out: `ready()` resolves,
  late initialization does not create identity/events, and the late lock is released.

Unit tests in `src/__tests__/main.test.ts` cover synthetic powerMonitor suspend/resume,
registered-window/tray semantics, quit cancellation in either listener order, and no added
fatal-error handlers. They do **not** simulate physical OS sleep, an actual tray icon, OS
shutdown, or a power failure. Windows/Linux and packaged-app behavior need separate validation.

Contracts were inspected via direct HTTPS from immutable sdk-specs revision
`4a9e0e7005260dbd198cd67c6ab6579c64679913`: consent-gating, opt-in, identify, capture,
persistent-storage, event-batcher, retry-queue, http-client, shutdown, application-lifecycle
and session-manager. Electron lifecycle is an explicitly documented desktop adaptation of the
native lifecycle spec. Exclusive ownership and 407 retention are conservative Electron policies,
not cross-SDK harness conformance or exactly-once delivery claims. Shutdown's delivery budget
also bounds deferred initialization; filesystem cleanup can finish later while keeping ownership.
