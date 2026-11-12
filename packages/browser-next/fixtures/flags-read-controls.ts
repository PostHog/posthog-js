import {
    FeatureFlagsExtension,
    type FeatureFlagsReadOptions,
    type FeatureFlagResult,
    type Disposable,
    type IPostHog,
} from '@posthog/browser'
import {
    featureFlags,
    type FeatureFlagsReadOptions as ProductReadOptions,
    type FeatureFlagResult as ProductResult,
} from '@posthog/browser/flags'

const options: FeatureFlagsReadOptions = { sendFeatureFlagEvent: false, fresh: true }
const productOptions: ProductReadOptions = options
const product = featureFlags({ featureFlagEvaluation: false })
const result: ProductResult | undefined = product.getFeatureFlag('checkout', productOptions)
const results: FeatureFlagResult[] = product.getAllFeatureFlags()
const subscription: Disposable = product.onReloading(() => {})
subscription.dispose()
void [result, results]

export const readFlags = async (posthog: IPostHog): Promise<FeatureFlagResult[]> => {
    const flags = await posthog.resolveExtension(FeatureFlagsExtension)
    const result: FeatureFlagResult | undefined = posthog.featureFlags?.getFeatureFlag('checkout', options)
    const subscription: Disposable | undefined = flags?.onReloading(() => {})
    subscription?.dispose()
    void result
    return flags?.getAllFeatureFlags() ?? []
}
