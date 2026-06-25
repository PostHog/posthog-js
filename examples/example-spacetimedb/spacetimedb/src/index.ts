import { schema, table, t } from 'spacetimedb/server'

// Project token (phc_) — publishable, safe to embed. Used by the procedures below.
const POSTHOG_PROJECT_TOKEN = 'phc_REPLACE_WITH_YOUR_PROJECT_TOKEN'
const POSTHOG_HOST = 'https://us.i.posthog.com'

const person = table(
    { name: 'person', public: true },
    {
        name: t.string(),
        addedBy: t.identity(),
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
    ctx.db.person.insert({ name, addedBy: ctx.sender })
})

export const sayHello = spacetimedb.reducer((ctx) => {
    for (const person of ctx.db.person.iter()) {
        console.info(`Hello, ${person.name}!`)
    }
    console.info('Hello, World!')
})

// Signal the sidecar to evaluate flags for the caller (reducers can't, no network).
// Keyed on ctx.sender so a client can only ever request its own flags.
export const requestFlagEval = spacetimedb.reducer((ctx) => {
    ctx.db.flagRequest.insert({ distinctId: ctx.sender.toHexString() })
})

// Upsert evaluated flags. Demo: any client can call this. In production, gate on
// caller identity — store the owner in `init` and require ctx.sender === owner.
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
                api_key: POSTHOG_PROJECT_TOKEN,
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

// Remote flag eval: a procedure can reach the network (reducers can't), so it POSTs
// to PostHog's /flags and returns the values straight to the caller — no sidecar, key, or table.
export const evaluateFlags = spacetimedb.procedure(t.string(), (ctx) => {
    const res = ctx.http.fetch(`${POSTHOG_HOST}/flags/?v=2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: POSTHOG_PROJECT_TOKEN,
            distinct_id: ctx.sender.toHexString(),
        }),
    })
    if (!res.ok) return '{}'
    const data = res.json() as { flags?: Record<string, { enabled: boolean; variant: string | null }> }
    const values: Record<string, boolean | string> = {}
    for (const [key, detail] of Object.entries(data.flags ?? {})) {
        values[key] = detail.variant ?? detail.enabled
    }
    return JSON.stringify(values)
})
