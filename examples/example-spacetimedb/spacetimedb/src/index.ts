import { schema, table, t } from 'spacetimedb/server'

// Project API key — publishable, safe to embed. Only used by the procedure below.
const POSTHOG_API_KEY = 'phc_REPLACE_WITH_YOUR_PROJECT_API_KEY'
const POSTHOG_HOST = 'https://us.i.posthog.com'

const person = table(
    { name: 'person', public: true },
    {
        name: t.string(),
    }
)

// Evaluated flags per distinct id. Written by the sidecar, read by clients via subscription.
const featureFlag = table(
    { name: 'feature_flag', public: true },
    {
        distinctId: t.string().primaryKey(),
        flagsJson: t.string(),
        updatedAt: t.timestamp(),
    }
)

// Request signal asking the sidecar to evaluate flags. Event table: rows fire
// `onInsert` on subscribers but are never stored.
const flagRequest = table(
    { name: 'flag_request', public: true, event: true },
    {
        distinctId: t.string(),
    }
)

const spacetimedb = schema({ person, featureFlag, flagRequest })
export default spacetimedb

export const add = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
    ctx.db.person.insert({ name })
})

export const sayHello = spacetimedb.reducer((ctx) => {
    for (const person of ctx.db.person.iter()) {
        console.info(`Hello, ${person.name}!`)
    }
    console.info('Hello, World!')
})

// Signal the sidecar to evaluate flags for `distinctId` (reducers can't, no network).
export const requestFlagEval = spacetimedb.reducer({ distinctId: t.string() }, (ctx, { distinctId }) => {
    ctx.db.flagRequest.insert({ distinctId })
})

// Upsert evaluated flags. Called by the sidecar only — the personal key stays server-side.
export const setFeatureFlags = spacetimedb.reducer(
    { distinctId: t.string(), flagsJson: t.string() },
    (ctx, { distinctId, flagsJson }) => {
        const row = { distinctId, flagsJson, updatedAt: ctx.timestamp }
        if (ctx.db.featureFlag.distinctId.find(distinctId)) {
            ctx.db.featureFlag.distinctId.update(row)
        } else {
            ctx.db.featureFlag.insert(row)
        }
    }
)

// In-module capture: procedures (unstable) can do network I/O, reducers can't.
// Posts an event straight to PostHog, no sidecar needed.
export const captureEvent = spacetimedb.procedure(
    { distinctId: t.string(), event: t.string() },
    t.bool(),
    (ctx, { distinctId, event }) => {
        const res = ctx.http.fetch(`${POSTHOG_HOST}/i/v0/e/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: POSTHOG_API_KEY,
                event,
                distinct_id: distinctId,
                properties: {
                    $lib: 'spacetimedb-module',
                    source: 'in-module-procedure',
                },
            }),
        })
        return res.ok
    }
)
