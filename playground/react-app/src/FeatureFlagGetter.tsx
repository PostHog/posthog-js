import { useFeatureFlagEnabled } from './posthog'

export function FeatureFlagGetter() {
    const featureFlag = useFeatureFlagEnabled('test')
    return <div>Feature flag response: {JSON.stringify(featureFlag)}</div>
}
