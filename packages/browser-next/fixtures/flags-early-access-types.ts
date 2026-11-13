import type {
    EarlyAccessFeature,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureStage,
    IPostHog,
} from '@posthog/browser'
import {
    featureFlags,
    type EarlyAccessFeature as ProductFeature,
    type EarlyAccessFeatureCallback as ProductCallback,
    type EarlyAccessFeatureStage as ProductStage,
} from '@posthog/browser/flags'
import type {
    EarlyAccessFeature as SharedFeature,
    EarlyAccessFeatureCallback as SharedCallback,
    EarlyAccessFeatureStage as SharedStage,
} from '@posthog/types'

const stages: EarlyAccessFeatureStage[] = ['concept', 'alpha', 'beta', 'general-availability']
const productStages: ProductStage[] = stages
const sharedStages: SharedStage[] = productStages
const callback: EarlyAccessFeatureCallback = (features: EarlyAccessFeature[]) => {
    const productFeatures: ProductFeature[] = features
    const sharedFeatures: SharedFeature[] = productFeatures
    void sharedFeatures
}
const productCallback: ProductCallback = callback
const sharedCallback: SharedCallback = productCallback

export const earlyAccess = featureFlags()
earlyAccess.getEarlyAccessFeatures(sharedCallback)
earlyAccess.getEarlyAccessFeatures(callback, true, sharedStages)
earlyAccess.updateEarlyAccessFeatureEnrollment('preview', true)
earlyAccess.updateEarlyAccessFeatureEnrollment('preview', false, 'custom-stage')

export const useEarlyAccess = (posthog: IPostHog): void => {
    posthog.featureFlags?.getEarlyAccessFeatures(productCallback, false, productStages)
    posthog.featureFlags?.updateEarlyAccessFeatureEnrollment('preview', true, 'beta')
}
