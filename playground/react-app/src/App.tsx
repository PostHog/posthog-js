import { PostHogProvider } from './posthog-provider'
import posthog from 'posthog-js'
import Button from './Button'
import { FeatureFlagGetter } from './FeatureFlagGetter'

function App() {
    posthog.init('phc_aIYpRzs2pU7hk93fqoTWtNezdeMUsNRCQFw7vnvDoOs', {
        api_host: 'https://app.posthog.com',
    })

    return (
        <PostHogProvider client={posthog}>
            <Button></Button>
            <FeatureFlagGetter></FeatureFlagGetter>
        </PostHogProvider>
    )
}

export default App
