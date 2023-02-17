import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

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
