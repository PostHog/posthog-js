import { PostHogProvider } from './posthog'
import posthog from 'posthog-js'
import Button from './Button'
import { FeatureFlagGetter } from './FeatureFlagGetter'

function App() {
    return (
        <PostHogProvider apiKey="phc_aIYpRzs2pU7hk93fqoTWtNezdeMUsNRCQFw7vnvDoOs">
            <Button></Button>
            <FeatureFlagGetter></FeatureFlagGetter>
        </PostHogProvider>
    )
}

export default App
