# browser-next real-data sandbox

A small Vite app for exercising the experimental `@posthog/browser` client against the shared PostHog US Cloud test project. It imports `packages/browser-next/src` directly, so local SDK edits appear immediately without packaging a tarball.

## Start

Install the monorepo dependencies once from the repository root, then install and run the independent playground:

```bash
pnpm install
cd playground/browser-next
pnpm install
pnpm dev:real
```

The root install supplies the workspace packages referenced by the local browser-next source. Open <http://127.0.0.1:5174>. The launcher reads `POSTHOG_TEST_PROJECT_TOKEN` from the environment or the approved macOS Keychain loader. It never writes or prints the token. You can override the loader path with `POSTHOG_REAL_TEST_CREDENTIAL_LOADER`.

If credentials are already managed in your shell, ordinary Vite startup also works:

```bash
VITE_POSTHOG_PROJECT_TOKEN="$POSTHOG_TEST_PROJECT_TOKEN" \
VITE_POSTHOG_HOST="${POSTHOG_TEST_HOST:-https://us.i.posthog.com}" \
pnpm dev
```

## What to try

- Leave explicit installation unchecked, capture an event, and watch default analytics load automatically.
- Disable automatic loading to observe buffer-only capture, then restart with explicit installation enabled.
- Install analytics explicitly during initialization to verify that it satisfies delivery without a duplicate dynamic load.
- Enable gzip and send the 16 KiB event to inspect compressed delivery.
- Dispatch offline, capture events, then dispatch online to redrive them.
- Opt out to purge queued work, opt back in, and capture again.
- Dispatch `pagehide` to exercise uncompressed keepalive handoff.
- Identify, group, reset, flush, and bounded shutdown.

The event-queue panel shows events moving from buffered to in-flight/retrying and then delivered, dropped, or purged. Each card shows abbreviated real values for its distinct, session, and window IDs; hover the row for the full values. Enable **Show identity, session, and sent metadata** there to expand the latest decoded V1 event and safe request metadata, including distinct, session, window, UUID, timestamp, options, properties, attempt, compression, and keepalive fields. Credential-like keys are redacted. This is a sandbox-only view inferred from admitted-event notifications and decoded plain/gzip Capture V1 envelopes, so the SDK does not gain public debug APIs or bundle weight. The separate request log shows URL paths, body sizes, compression, keepalive use, and response status without request headers or bodies.

## Shared-project safety

The sandbox:

- prefixes manually named capture events with `real_posthog_test_`; identity and group actions use PostHog's reserved event names;
- prefixes operator-supplied identified IDs with `real-posthog-test-`; anonymous IDs remain SDK-generated UUIDs;
- adds a unique `test_run_id`, `synthetic: true`, and `$process_person_profile: false` to captured events;
- disables automatic pageviews and bot filtering for explicit headless-browser testing;
- does not expose `POSTHOG_PERSONAL_API_KEY` to Vite or mutate project configuration.

Keep event volume low. Enter only synthetic properties and identity suffixes—never customer data, personal data, or secrets. The run ID shown in the UI can be copied and used to find this session's events in [project 225020](https://us.posthog.com/project/225020).
