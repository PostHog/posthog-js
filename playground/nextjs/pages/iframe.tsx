import Head from 'next/head'

export default function Iframe() {
    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>PostHog IFrame test</h1>

                <iframe src="http://localhost:3000" width={800} height={800} />
            </main>
        </>
    )
}
