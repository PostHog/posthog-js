import { PostHog } from 'posthog-node'
import { DbConnection, tables } from '../src/module_bindings'

// Trusted sidecar. Reducers can't reach the network, so backend PostHog work runs
// here: capture row changes with posthog-node, and evaluate feature flags locally.

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000'
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? 'posthog-spacetimedb'

// Personal key (phx_…) enables local flag eval. Secret — backend only.
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY
const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN ?? '', {
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
    // 'Transaction' = live change; the initial backfill is 'SubscribeApplied'. Skip it.
    if (ctx.event.tag !== 'Transaction') return

    // distinctId is the actor's SpacetimeDB identity (the same id the frontend
    // identifies as), so client + sidecar events stitch to one person.
    posthog.capture({
        distinctId: person.addedBy.toHexString(),
        event: 'person_added',
        properties: {
            name: person.name,
            source: 'spacetimedb-sidecar',
        },
    })
    console.log(`[sidecar] captured person_added for "${person.name}"`)
})

conn.db.flagRequest.onInsert((_ctx, request) => {
    // Event-table rows aren't backfilled, so every insert is a live request.
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
