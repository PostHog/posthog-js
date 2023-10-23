import Home from './content'
import { cookies } from 'next/headers'
import { PostHog } from 'posthog-node'
import { PostHogCapture } from './providers'

function PostHogClient() {
    const posthog = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
    })
    return posthog
}

export const metadata = {
    title: 'PostHog',
}

export default async function Page() {
    const randomID = () => Math.round(Math.random() * 10000)
    const posthog = PostHogClient()
    const cookieName = `ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY || ''}_posthog`
    const cookieStore = cookies()
    const cookie = cookieStore.get(cookieName)
    const distinctId = !cookie || !cookie.value ? randomID() : JSON.parse(cookie.value).distinct_id
    const flags = await posthog.getAllFlags(distinctId)
    return (
        <PostHogCapture distinctId={distinctId}>
            <Home flags={flags} />
        </PostHogCapture>
    )
}
