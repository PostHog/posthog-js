import { logger } from './utils/logger'
import type { PostHogFeatureFlags } from './posthog-featureflags'

const FN_UNDEFINED = () => {}
const FN_ARRAY = () => []
const FN_OBJECT = () => ({})
const FN_CALLBACK = () => () => {}

// Stub returned by the featureFlags getter when PostHogFeatureFlags is not loaded (e.g. slim bundle).
// Known defaults are explicit (mangle-safe), the Proxy catches any future methods with a logged no-op.
export const FEATURE_FLAGS_STUB = new Proxy(
    {
        $anon_distinct_id: undefined,
        _override_warning: false,
        featureFlagEventHandlers: [],
        hasLoadedFlags: false,
        getFlags: FN_ARRAY,
        getFlagsWithDetails: FN_OBJECT,
        getFlagVariants: FN_OBJECT,
        getFlagPayloads: FN_OBJECT,
        onFeatureFlags: FN_CALLBACK,
        _prepareFeatureFlagsForCallbacks: () => ({ flags: [], flagVariants: {} }),
    } as Partial<PostHogFeatureFlags>,
    {
        get: (target, p) => {
            logger.error('[PostHog] Feature flags is not yet loaded or not included in this bundle')
            return p in target ? target[p as keyof typeof target] : FN_UNDEFINED
        },
    }
) as PostHogFeatureFlags
