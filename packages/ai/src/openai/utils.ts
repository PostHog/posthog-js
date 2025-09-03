import { v4 as uuidv4 } from 'uuid'
import { MonitoringEventProperties, MonitoringEventPropertiesWithDefaults, MonitoringParams } from '../utils'

const POSTHOG_PARAMS_MAP: Record<string, string> = {
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
    if (POSTHOG_PARAMS_MAP[key]) {
      posthogParams[POSTHOG_PARAMS_MAP[key]] = value
    } else {
      if (key.startsWith('posthog')) {
        throw new Error(`Posthog parameter ${key} is being passed to the OpenAI client, and will cause it to fail`)
      }
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
