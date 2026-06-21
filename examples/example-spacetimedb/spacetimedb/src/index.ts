import { schema, table, t } from 'spacetimedb/server'

// PostHog project API keys are publishable — they ship in browser bundles and are
// safe to embed here too. Swap in your own from Project settings → API keys, or
// leave the placeholder and rely on the Node sidecar for backend capture instead.
const POSTHOG_API_KEY = 'phc_REPLACE_WITH_YOUR_PROJECT_API_KEY'
const POSTHOG_HOST = 'https://us.i.posthog.com'

const person = table(
    { name: 'person', public: true },
    {
        name: t.string(),
    }
)

// Holds the locally-evaluated feature flags for a given distinct id. Written only
// by the sidecar (via the `setFeatureFlags` reducer) and read by clients through a
// subscription. One row per distinct id; `flagsJson` is the serialized flag map.
const featureFlag = table(
    { name: 'feature_flag', public: true },
    {
        distinctId: t.string().primaryKey(),
        flagsJson: t.string(),
        updatedAt: t.timestamp(),
    }
)

// A request signal: clients append a row to ask the sidecar to evaluate flags for a
// distinct id. As an event table, rows are never stored — they only fire `onInsert`
// on subscribers (the sidecar), so this is a clean fire-and-forget channel.
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

// Ask the backend to evaluate feature flags for `distinctId`. The sidecar picks this
// up, evaluates locally with the personal API key, and writes the result back via
// `setFeatureFlags`. Reducers can't reach PostHog themselves (no network), so flag
// evaluation has to happen out-of-band in the sidecar.
export const requestFlagEval = spacetimedb.reducer({ distinctId: t.string() }, (ctx, { distinctId }) => {
    ctx.db.flagRequest.insert({ distinctId })
})

// Upsert the evaluated flag map for a distinct id. Called by the sidecar, never the
// browser — the personal key that produced these values stays server-side.
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

// In-module instrumentation. Reducers are deterministic and cannot touch the
// network, but procedures (unstable) may perform side effects — including the
// outbound HTTP call needed to reach PostHog. This posts an event straight from
// inside the database, no sidecar process required.
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
