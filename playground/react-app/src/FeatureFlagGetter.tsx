import { useFeatureFlagEnabled } from 'posthog-js/react'

export function FeatureFlagGetter() {
    const featureFlag = useFeatureFlagEnabled('test')
    return <div>Feature flag response: {JSON.stringify(featureFlag)}</div>
}
