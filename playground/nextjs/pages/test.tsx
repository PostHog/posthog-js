import { useFeatureFlag, usePostHog } from '@/posthog'
import { useEffect, useState } from 'react'

export default function Test() {
    const posthog = usePostHog()

    const result = useFeatureFlag('test')

    // const [text, setText] = useState('')

    // useEffect(() => {
    //     setText(result?.toString() || '')
    // }, [result])

    return (
        <div>
            <p>Test</p>
            <button onClick={() => posthog?.capture('Clicked')}>This is a button {result?.toString()}</button>
        </div>
    )
}
