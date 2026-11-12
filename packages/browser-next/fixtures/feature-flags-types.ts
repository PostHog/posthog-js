import { FeatureFlagsExtension, type IFeatureFlags, type FeatureFlagsConfiguration } from '@posthog/browser'
import type { IFeatureFlags as CoreFeatureFlags, IPostHog, IPostHogInternal } from '@posthog/browser/core'
import {
    featureFlags,
    type IFeatureFlags as ProductFeatureFlags,
    type FeatureFlagsOptions,
    type FeatureFlagsCallback,
    type FeatureFlagsReloadResult,
} from '@posthog/browser/flags'
import {
    FeatureFlagsCommonExtension,
    type Client,
    type IFeatureFlagsCommon,
    type FeatureFlagsReloadResult as CommonReloadResult,
} from '@posthog/browser-common'
import type { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'

const options: FeatureFlagsOptions = { featureFlagEvaluation: false }
const configuration: FeatureFlagsConfiguration = options
const callback: FeatureFlagsCallback = (results, errorsLoading) => {
    const enabled: boolean | undefined = results[0]?.enabled
    void [enabled, errorsLoading]
}
export const explicitFeatureFlags: IFeatureFlags = featureFlags(options)
const coreFeatureFlags: CoreFeatureFlags = explicitFeatureFlags
const productFeatureFlags: ProductFeatureFlags = coreFeatureFlags
void [configuration, productFeatureFlags]

export const resolveFeatureFlags = async (posthog: IPostHog, internal: IPostHogInternal): Promise<void> => {
    const extension: IFeatureFlags | undefined = await posthog.resolveExtension(FeatureFlagsExtension)
    const property: IFeatureFlags | undefined = posthog.featureFlags
    extension?.onFeatureFlags(callback).dispose()
    const outcome: FeatureFlagsReloadResult | undefined = await extension?.reloadFeatureFlags()
    const commonOutcome: CommonReloadResult | undefined = outcome
    const context = internal.featureFlags?.getSurveyContext()
    void [property, commonOutcome, context]
    // @ts-expect-error Survey targeting context is an SDK-only capability.
    extension?.getSurveyContext()
}

type SharedImplementationShape = Pick<PostHogFeatureFlags, keyof PostHogFeatureFlags>

export const checkSharedFeatureFlags = (
    client: Client,
    structural: SharedImplementationShape,
    contract: IFeatureFlagsCommon
): void => {
    const fromImplementation: IFeatureFlagsCommon = structural
    const toImplementation: SharedImplementationShape = contract
    const resolved = client.getExtension(FeatureFlagsCommonExtension)
    const replacement: typeof resolved = structural
    void [fromImplementation, toImplementation, replacement]
}
