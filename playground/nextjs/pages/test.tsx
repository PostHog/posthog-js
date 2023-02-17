import { useFeatureFlagEnabled, usePostHog } from '@/posthog'

export default function Test() {
    const posthog = usePostHog()

    const result = useFeatureFlagEnabled('test')

    return (
        <div>
            <p>Test</p>
            <button onClick={() => posthog?.capture('Clicked')}>This is a button</button>
            <p>Feature flag response: {JSON.stringify(result)}</p>
        </div>
    )
}
