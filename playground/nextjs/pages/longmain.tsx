import Head from 'next/head'
import Link from 'next/link'
import React, { useEffect } from 'react'

export default function Home() {
    useEffect(() => {
        const html = document.querySelector('html')
        const body = document.querySelector('body')
        const nextRoot = document.querySelector<HTMLDivElement>('div#__next')
        if (!html || !body || !nextRoot) return
        html.style.height = '100%'
        html.style.overflow = 'hidden'
        body.style.height = '100%'
        nextRoot.style.height = '100%'
        return () => {
            html.style.height = ''
            html.style.overflow = ''
            body.style.height = ''
            nextRoot.style.height = ''
        }
    }, [])

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main
                id="scroll_element"
                style={{
                    height: '100%',
                    overflow: 'scroll',
                    margin: 0,
                    padding: 0,
                }}
            >
                <div
                    style={{
                        height: '4000px',
                        overflow: 'hidden',
                    }}
                >
                    <h1>A long page</h1>
                    <p>
                        The window itself does not scroll, the <code>main</code> element does. The content is exactly
                        4000px tall.
                    </p>
                    <div className="buttons">
                        <Link href="/">Home</Link>
                    </div>

                    {Array.from({ length: 100 }, (_, i) => (
                        <p key={i}>
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut
                            labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
                            laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
                            voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat
                            cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
                        </p>
                    ))}

                    <div className="buttons">
                        <Link href="/">Home</Link>
                    </div>
                </div>
            </main>
        </>
    )
}
