import { PostHogProvider } from './posthog-provider'
import posthog from 'posthog-js'
import Button from './Button'

function App() {
    posthog.init(process.env.POSTHOG_API_KEY || '', {
        api_host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
    })

    return (
        <PostHogProvider client={posthog}>
            <Button></Button>
        </PostHogProvider>
    )
}

export default App
