import { useEffect } from 'react'
import { posthog } from '@/src/posthog'

const MobileAppAttribution = () => {
    useEffect(() => {
        if (
            navigator.userAgent.toLowerCase().includes('linkedin') ||
            navigator.userAgent.toLowerCase().includes('facebook')
        ) {
            const params = new URLSearchParams(window.location.search)
            params.set('__ph_distinct_id', posthog.get_distinct_id())
            params.set('__ph_is_identified', posthog._isIdentified() ? 'true' : 'false')
            params.set('__ph_session_id', posthog.get_session_id())
            window.location.search = params.toString()
        }
    })
    return (
        <div className="max-w-sm mx-auto space-y-4">
            Try posting a link to this page to LinkedIn or Facebook etc, then open with the in-app browser. Then try
            pressing the "open in safari" button. If you check the activity tab, these should appear to be the same
            person.
        </div>
    )
}

export default MobileAppAttribution
