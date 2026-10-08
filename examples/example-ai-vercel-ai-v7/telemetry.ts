type PostHogAttributeValue = string | number | boolean

const RESERVED_ATTRIBUTE_KEYS = new Set(['posthog.distinct_id', '$ai_session_id', '$groups', '$ai_trace_name'])

function isAttributeValue(value: unknown): value is PostHogAttributeValue {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * Maps selected AI SDK runtime context into PostHog event properties.
 *
 * Keep credentials and other sensitive request state out of runtimeContext
 * fields selected by telemetry.includeRuntimeContext.
 */
export function getPostHogSpanAttributes({
    runtimeContext,
}: {
    runtimeContext: Record<string, unknown> | undefined
}): Record<string, PostHogAttributeValue> {
    const attributes: Record<string, PostHogAttributeValue> = {}

    const properties = runtimeContext?.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        for (const [key, value] of Object.entries(properties)) {
            if (!RESERVED_ATTRIBUTE_KEYS.has(key) && isAttributeValue(value)) {
                attributes[key] = value
            }
        }
    }

    if (typeof runtimeContext?.distinctId === 'string') {
        attributes['posthog.distinct_id'] = runtimeContext.distinctId
    }

    if (typeof runtimeContext?.sessionId === 'string') {
        attributes.$ai_session_id = runtimeContext.sessionId
    }

    if (typeof runtimeContext?.traceName === 'string') {
        attributes.$ai_trace_name = runtimeContext.traceName
    }

    const groups = runtimeContext?.groups
    if (groups && typeof groups === 'object' && !Array.isArray(groups)) {
        const serializableGroups: Record<string, PostHogAttributeValue> = {}
        for (const [groupType, groupId] of Object.entries(groups)) {
            if (isAttributeValue(groupId)) {
                serializableGroups[groupType] = groupId
            }
        }
        if (Object.keys(serializableGroups).length > 0) {
            attributes.$groups = JSON.stringify(serializableGroups)
        }
    }

    return attributes
}
