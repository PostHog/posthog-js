import { PostHog } from 'posthog-node'
import { DbConnection, tables } from '../src/module_bindings'

// Backend instrumentation as a trusted sidecar process.
//
// SpacetimeDB reducers are deterministic and cannot reach the network, so a
// PostHog client can't live inside the module. Instead this process connects to
// the database like any other client, subscribes to the tables it cares about,
// and turns row changes into PostHog work with `posthog-node`. It runs on stable
// APIs and is decoupled from request latency. It does two things:
//
//   1. Captures `person_added` whenever the `add` reducer inserts a person.
//   2. Evaluates feature flags locally (using the personal API key) whenever a
//      client asks via the `flag_request` event table, then writes the result
//      back into the `feature_flag` table for clients to read.

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000'
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? 'posthog-spacetimedb'

// The personal API key (phx_…) enables LOCAL flag evaluation — posthog-node polls
// the flag definitions and evaluates in-process, no per-call network round-trip.
// It is a secret and must never leave the backend (not the module, not the browser).
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY
const posthog = new PostHog(process.env.POSTHOG_API_KEY ?? '', {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    personalApiKey,
})
if (!personalApiKey) {
    console.warn('[sidecar] POSTHOG_PERSONAL_API_KEY not set — flag evaluation will fall back to remote /flags calls')
}

const conn = DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .onConnect((conn, identity) => {
        console.log(`[sidecar] connected to ${DB_NAME} as ${identity.toHexString()}`)
        conn.subscriptionBuilder().subscribe([tables.person, tables.flagRequest])
    })
    .onConnectError((_ctx, err) => console.error('[sidecar] connection error:', err))
    .onDisconnect(() => console.log('[sidecar] disconnected'))
    .build()

conn.db.person.onInsert((ctx, person) => {
    // The initial subscription backfill arrives tagged `SubscribeApplied`; live
    // changes are tagged `Transaction`. Skip the backfill so we only capture real
    // activity, not the rows that already existed when we connected.
    if (ctx.event.tag !== 'Transaction') return

    posthog.capture({
        distinctId: person.name,
        event: 'person_added',
        properties: {
            source: 'spacetimedb-sidecar',
        },
    })
    console.log(`[sidecar] captured person_added for "${person.name}"`)
})

conn.db.flagRequest.onInsert((_ctx, request) => {
    // Event-table rows are never backfilled, so every insert here is a live request.
    void (async () => {
        const { distinctId } = request
        const flags = await posthog.getAllFlags(distinctId)
        await conn.reducers.setFeatureFlags({ distinctId, flagsJson: JSON.stringify(flags) })
        console.log(`[sidecar] evaluated ${Object.keys(flags).length} flag(s) for "${distinctId}"`)
    })().catch((err) => console.error('[sidecar] flag evaluation failed:', err))
})

const shutdown = async () => {
    await posthog.shutdown()
    process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
