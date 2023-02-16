import { PostHogProvider } from './posthog'
import posthog from 'posthog-js'
import Button from './Button'
import { FeatureFlagGetter } from './FeatureFlagGetter'

function App() {

    return (
        <PostHogProvider client={posthog}>
            <Button></Button>
            <FeatureFlagGetter></FeatureFlagGetter>
        </PostHogProvider>
    )
}

export default App
