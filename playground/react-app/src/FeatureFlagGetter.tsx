import { useFeatureFlag } from './posthog-provider'

export function FeatureFlagGetter() {
    const featureFlag = useFeatureFlag('test')
    return <div>Feature flag response: {JSON.stringify(featureFlag)}</div>
}
