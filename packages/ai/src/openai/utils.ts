import { v4 as uuidv4 } from 'uuid'
import { MonitoringEventProperties, MonitoringEventPropertiesWithDefaults, MonitoringParams } from '../utils'

const POSTHOG_PARAMS_MAP: Record<keyof MonitoringParams, string> = {
  posthogDistinctId: 'distinctId',
  posthogTraceId: 'traceId',
  posthogProperties: 'properties',
  posthogPrivacyMode: 'privacyMode',
  posthogGroups: 'groups',
  posthogModelOverride: 'modelOverride',
  posthogProviderOverride: 'providerOverride',
  posthogCostOverride: 'costOverride',
  posthogCaptureImmediate: 'captureImmediate',
}

export function extractPosthogParams<T>(body: T & MonitoringParams): {
  openAIParams: T
  posthogParams: MonitoringEventPropertiesWithDefaults
} {
  const openAIParams: Record<string, unknown> = {}
  const posthogParams: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (POSTHOG_PARAMS_MAP[key as keyof MonitoringParams]) {
      posthogParams[POSTHOG_PARAMS_MAP[key as keyof MonitoringParams]] = value
    } else if (key.startsWith('posthog')) {
      console.warn(`Unknown Posthog parameter ${key}`)
    } else {
      openAIParams[key] = value
    }
  }

  return {
    openAIParams: openAIParams as T,
    posthogParams: addDefaults(posthogParams),
  }
}

function addDefaults(params: MonitoringEventProperties): MonitoringEventPropertiesWithDefaults {
  return {
    ...params,
    privacyMode: params.privacyMode ?? false,
    traceId: params.traceId ?? uuidv4(),
  }
}
