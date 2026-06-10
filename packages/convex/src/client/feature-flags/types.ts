import type { FeatureFlagValue, JsonType } from '@posthog/core'

export type { FeatureFlagValue, JsonType }

export type FlagPropertyValue = string | number | (string | number)[] | boolean

export type FlagProperty = {
  key: string
  type?: string
  value: FlagPropertyValue
  operator?: string
  negation?: boolean
  dependency_chain?: string[]
}

export type PropertyGroup = {
  type: 'AND' | 'OR'
  values: PropertyGroup[] | FlagProperty[]
}

export type FeatureFlagCondition = {
  properties: FlagProperty[]
  rollout_percentage?: number
  variant?: string
  aggregation_group_type_index?: number | null
}

export type FeatureFlagBucketingIdentifier = 'distinct_id' | 'device_id' | '' | null

export type PostHogFeatureFlag = {
  id: number
  name: string
  key: string
  bucketing_identifier?: FeatureFlagBucketingIdentifier
  filters?: {
    aggregation_group_type_index?: number
    groups?: FeatureFlagCondition[]
    multivariate?: {
      variants: {
        key: string
        rollout_percentage: number
      }[]
    }
    payloads?: Record<string, string>
  }
  deleted: boolean
  active: boolean
  rollout_percentage: null | number
  ensure_experience_continuity: boolean
  experiment_set: number[]
}

export type FlagDefinitions = {
  flags: PostHogFeatureFlag[]
  groupTypeMapping: Record<string, string>
  cohorts: Record<string, PropertyGroup>
}

export type FeatureFlagEvaluationContext = {
  distinctId: string
  groups: Record<string, string>
  personProperties: Record<string, any>
  groupProperties: Record<string, Record<string, any>>
  evaluationCache: Record<string, FeatureFlagValue>
}

export type FeatureFlagResult = {
  key: string
  enabled: boolean
  variant: string | null
  payload: JsonType | null
}
