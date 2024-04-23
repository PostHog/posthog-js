import { Html, Head, Main, NextScript } from 'next/document'
import React from 'react'

export default function Document() {
    return (
        <Html lang="en">
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>

            <body>
                <Main />
            </body>
            <NextScript />
        </Html>
    )
}
