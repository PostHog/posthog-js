import { useEffect, useState } from 'react'

// Try this page with some of the following commands:
// chrome --headless --disable-gpu --print-to-pdf http://localhost:3000/ua --virtual-time-budget=10000
// chrome --headless --disable-gpu --print-to-pdf http://localhost:3000/ua --virtual-time-budget=10000 --user-agent="RealHuman"

export default function Home() {
    const [isClient, setIsClient] = useState(false)
    useEffect(() => {
        setIsClient(true)
    }, [])
    if (!isClient) {
        return <pre>Not client</pre>
    }
    return (
        <dl>
            <dt>UA</dt>
            <dd>
                <code>{navigator.userAgent}</code>
            </dd>
            <dt>WebDriver</dt>
            <dd>
                <code>{String(navigator.webdriver)}</code>
            </dd>
            <dt>NavigatorUAData brands</dt>
            <dd>
                {/* eslint-disable-next-line compat/compat */}
                <code>{JSON.stringify((navigator as any).userAgentData?.brands)}</code>
            </dd>
        </dl>
    )
}
