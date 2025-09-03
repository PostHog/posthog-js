import { v4 as uuidv4 } from 'uuid'
import { MonitoringEventProperties, MonitoringEventPropertiesWithDefaults, MonitoringParams } from '../utils'

export function extractPosthogParams<T>(body: T & MonitoringParams): {
  openAIParams: T
  posthogParams: MonitoringEventPropertiesWithDefaults
} {
  const openAIParams: Record<string, unknown> = {}
  const posthogParams: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (isPosthogParam(key)) {
      const unprefixedKey = removePosthogPrefix(key)
      posthogParams[unprefixedKey] = value
    } else {
      openAIParams[key] = value
    }
  }

  return {
    openAIParams: openAIParams as T,
    posthogParams: addDefaults(posthogParams as MonitoringEventProperties),
  }
}

function isPosthogParam(key: string): key is keyof MonitoringParams {
  return key.startsWith('posthog')
}

function removePosthogPrefix(key: keyof MonitoringParams): keyof MonitoringEventProperties {
  const unprefixed = key.replace(/^posthog/, '')
  return (unprefixed.charAt(0).toLowerCase() + unprefixed.slice(1)) as keyof MonitoringEventProperties
}

function addDefaults(params: MonitoringEventProperties): MonitoringEventPropertiesWithDefaults {
  return {
    ...params,
    privacyMode: params.privacyMode ?? false,
    traceId: params.traceId ?? uuidv4(),
  }
}
