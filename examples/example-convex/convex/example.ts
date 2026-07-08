import { posthog } from './posthog.js'
import { action, mutation, query } from './_generated/server.js'
import { components } from './_generated/api.js'
import { v } from 'convex/values'

// --- Fire-and-forget methods (mutations) ---
// When the identify callback is configured, distinctId is resolved automatically
// from the signed-in user. Pass distinctId explicitly to override or when the
// user is not signed in.

export const testCapture = mutation({
    args: {
        distinctId: v.optional(v.string()),
        event: v.string(),
        properties: v.optional(v.any()),
        groups: v.optional(v.any()),
        sendFeatureFlags: v.optional(v.boolean()),
        timestamp: v.optional(v.string()),
        uuid: v.optional(v.string()),
        disableGeoip: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await posthog.capture(ctx, {
            distinctId: args.distinctId,
            event: args.event,
            properties: args.properties,
            groups: args.groups,
            sendFeatureFlags: args.sendFeatureFlags,
            timestamp: args.timestamp ? new Date(args.timestamp) : undefined,
            uuid: args.uuid || undefined,
            disableGeoip: args.disableGeoip,
        })
        return { success: true }
    },
})

export const testIdentify = mutation({
    args: {
        distinctId: v.optional(v.string()),
        properties: v.optional(v.any()),
        disableGeoip: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await posthog.identify(ctx, {
            distinctId: args.distinctId,
            properties: args.properties,
            disableGeoip: args.disableGeoip,
        })
        return { success: true }
    },
})

export const testCaptureException = mutation({
    args: {
        errorMessage: v.string(),
        errorType: v.optional(v.union(v.literal('error'), v.literal('string'), v.literal('object'))),
        distinctId: v.optional(v.string()),
        additionalProperties: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        let error: unknown
        switch (args.errorType ?? 'error') {
            case 'error':
                error = new Error(args.errorMessage)
                break
            case 'string':
                error = args.errorMessage
                break
            case 'object':
                error = { message: args.errorMessage }
                break
        }

        await posthog.captureException(ctx, {
            error,
            distinctId: args.distinctId || undefined,
            additionalProperties: args.additionalProperties,
        })
        return { success: true }
    },
})

export const testThrowError = mutation({
    args: {
        errorMessage: v.string(),
    },
    handler: async (_ctx, args) => {
        throw new Error(args.errorMessage)
    },
})

// --- Feature flag methods (actions) ---

const featureFlagArgs = {
    distinctId: v.optional(v.string()),
    flagKey: v.string(),
    groups: v.optional(v.any()),
    personProperties: v.optional(v.any()),
    groupProperties: v.optional(v.any()),
    disableGeoip: v.optional(v.boolean()),
}

function featureFlagOptions(args: {
    groups?: unknown
    personProperties?: unknown
    groupProperties?: unknown
    disableGeoip?: boolean
}) {
    return {
        groups: args.groups as Record<string, string> | undefined,
        personProperties: args.personProperties as Record<string, string> | undefined,
        groupProperties: args.groupProperties as Record<string, Record<string, string>> | undefined,
        disableGeoip: args.disableGeoip,
    }
}

export const testGetFeatureFlag = query({
    args: featureFlagArgs,
    handler: async (ctx, args) => {
        const value = await posthog.getFeatureFlag(ctx, {
            key: args.flagKey,
            distinctId: args.distinctId,
            ...featureFlagOptions(args),
        })
        return { flagKey: args.flagKey, value: value ?? null }
    },
})

export const testIsFeatureEnabled = query({
    args: featureFlagArgs,
    handler: async (ctx, args) => {
        const enabled = await posthog.isFeatureEnabled(ctx, {
            key: args.flagKey,
            distinctId: args.distinctId,
            ...featureFlagOptions(args),
        })
        return { flagKey: args.flagKey, enabled: enabled ?? null }
    },
})

export const testGetFeatureFlagPayload = query({
    args: {
        ...featureFlagArgs,
        matchValue: v.optional(v.union(v.boolean(), v.string())),
    },
    handler: async (ctx, args) => {
        const payload = await posthog.getFeatureFlagPayload(ctx, {
            key: args.flagKey,
            distinctId: args.distinctId,
            matchValue: args.matchValue,
            ...featureFlagOptions(args),
        })
        return { flagKey: args.flagKey, payload }
    },
})

export const testGetFeatureFlagResult = query({
    args: featureFlagArgs,
    handler: async (ctx, args) => {
        const result = await posthog.getFeatureFlagResult(ctx, {
            key: args.flagKey,
            distinctId: args.distinctId,
            ...featureFlagOptions(args),
        })
        return { flagKey: args.flagKey, result: result ?? null }
    },
})

export const testGetAllFlags = query({
    args: {
        distinctId: v.optional(v.string()),
        groups: v.optional(v.any()),
        personProperties: v.optional(v.any()),
        groupProperties: v.optional(v.any()),
        disableGeoip: v.optional(v.boolean()),
        flagKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const flags = await posthog.getAllFlags(ctx, {
            distinctId: args.distinctId,
            groups: args.groups as Record<string, string> | undefined,
            personProperties: args.personProperties as Record<string, string> | undefined,
            groupProperties: args.groupProperties as Record<string, Record<string, string>> | undefined,
            disableGeoip: args.disableGeoip,
            flagKeys: args.flagKeys,
        })
        return { flags }
    },
})

// --- Cache inspection helpers (used by the demo UI to surface the cron's progress) ---

export const flagDefinitionsStatus = query({
    args: {},
    handler: async (ctx) => {
        const row = await ctx.runQuery(components.posthog.lib.getFlagDefinitions, {})
        if (!row) return null
        let flagKeys: string[] = []
        try {
            const parsed = JSON.parse(row.data) as { flags?: Array<{ key?: string }> }
            flagKeys = parsed.flags?.map((f) => f.key ?? '<unnamed>') ?? []
        } catch {
            // ignore parse errors — keys list stays empty.
        }
        return {
            fetchedAt: row.fetchedAt,
            etag: row.etag ?? null,
            flagCount: flagKeys.length,
            flagKeys,
        }
    },
})

// --- Remote feature flag evaluation wrappers ---
//
// These are action-context actions that hit PostHog's `/flags` endpoint via the client's
// `evaluate*` methods. Use them when local eval isn't possible (no personal API key, experience
// continuity flags, static cohorts, properties you don't have server-side).

const remoteFlagArgs = {
    distinctId: v.optional(v.string()),
    flagKey: v.string(),
    groups: v.optional(v.any()),
    personProperties: v.optional(v.any()),
    groupProperties: v.optional(v.any()),
    disableGeoip: v.optional(v.boolean()),
}

function remoteFlagOptions(args: {
    groups?: unknown
    personProperties?: unknown
    groupProperties?: unknown
    disableGeoip?: boolean
}) {
    return {
        groups: args.groups as Record<string, string> | undefined,
        personProperties: args.personProperties as Record<string, unknown> | undefined,
        groupProperties: args.groupProperties as Record<string, Record<string, unknown>> | undefined,
        disableGeoip: args.disableGeoip,
    }
}

export const testEvaluateFlag = action({
    args: remoteFlagArgs,
    handler: async (ctx, args) => {
        const value = await posthog.evaluateFlag(ctx, {
            key: args.flagKey,
            distinctId: args.distinctId,
            ...remoteFlagOptions(args),
        })
        return { flagKey: args.flagKey, value }
    },
})

export const testEvaluateFlagPayload = action({
    args: remoteFlagArgs,
    handler: async (ctx, args) => {
        const payload = await posthog.evaluateFlagPayload(ctx, {
            key: args.flagKey,
            distinctId: args.distinctId,
            ...remoteFlagOptions(args),
        })
        return { flagKey: args.flagKey, payload }
    },
})

export const testEvaluateAllFlags = action({
    args: {
        distinctId: v.optional(v.string()),
        groups: v.optional(v.any()),
        personProperties: v.optional(v.any()),
        groupProperties: v.optional(v.any()),
        disableGeoip: v.optional(v.boolean()),
        flagKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return await posthog.evaluateAllFlags(ctx, {
            distinctId: args.distinctId,
            groups: args.groups as Record<string, string> | undefined,
            personProperties: args.personProperties as Record<string, unknown> | undefined,
            groupProperties: args.groupProperties as Record<string, Record<string, unknown>> | undefined,
            disableGeoip: args.disableGeoip,
            flagKeys: args.flagKeys,
        })
    },
})

export const testGetAllFlagsAndPayloads = query({
    args: {
        distinctId: v.optional(v.string()),
        groups: v.optional(v.any()),
        personProperties: v.optional(v.any()),
        groupProperties: v.optional(v.any()),
        disableGeoip: v.optional(v.boolean()),
        flagKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const result = await posthog.getAllFlagsAndPayloads(ctx, {
            distinctId: args.distinctId,
            groups: args.groups as Record<string, string> | undefined,
            personProperties: args.personProperties as Record<string, string> | undefined,
            groupProperties: args.groupProperties as Record<string, Record<string, string>> | undefined,
            disableGeoip: args.disableGeoip,
            flagKeys: args.flagKeys,
        })
        return result
    },
})
