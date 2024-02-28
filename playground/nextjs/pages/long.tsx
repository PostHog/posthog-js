import Head from 'next/head'
import Link from 'next/link'
import React from 'react'

export default function Home() {
    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>A long page</h1>
                <div className="flex items-center gap-2">
                    <Link href="/">Home</Link>
                </div>

                {Array.from({ length: 100 }, (_, i) => (
                    <p key={i}>
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut
                        labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
                        laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
                        voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat
                        non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
                    </p>
                ))}

                <div className="flex items-center gap-2">
                    <Link href="/">Home</Link>
                </div>
            </main>
        </>
    )
}
