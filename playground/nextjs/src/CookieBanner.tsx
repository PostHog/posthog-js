import { useEffect, useState } from 'react'

export function CookieBanner() {
    const [show, setShow] = useState<null | boolean>(null)

    useEffect(() => {
        setShow(localStorage.getItem('cookie_consent') !== 'true')
    }, [])

    // eslint-disable-next-line posthog-js/no-direct-null-check
    if (show === null) return null

    return (
        <div className="fixed right-2 bottom-2 border rounded p-2 bg-gray-100 text-sm">
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
                        Give back my cookies!
                    </button>
                </>
            )}
        </div>
    )
}
