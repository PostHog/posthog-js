import { useEffect, useState } from 'react'

export function CookieBanner() {
    const [show, setShow] = useState<null | boolean>(null)

    useEffect(() => {
        setShow(localStorage.getItem('cookie_consent') !== 'true')
    }, [])

    // eslint-disable-next-line posthog-js/no-direct-null-check
    if (show === null) return null

    return (
        <div className="absolute left-2 bottom-2 border rounded p-2">
            {show ? (
                <>
                    <p>I am a cookie banner - hear me roar.</p>
                    <button
                        onClick={() => {
                            localStorage.setItem('cookie_consent', 'true')
                            setShow(false)
                        }}
                    >
                        Approved!
                    </button>
                </>
            ) : (
                <>
                    <button
                        onClick={() => {
                            localStorage.removeItem('cookie_consent')
                            setShow(true)
                        }}
                    >
                        No cookies!
                    </button>
                </>
            )}
        </div>
    )
}
