import Head from 'next/head'
import { useFeatureFlag, usePostHog, PostHogFeature } from 'posthog-js/react'

export default function Home() {
    const posthog = usePostHog()
    const result = useFeatureFlag('test')
    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>PostHog React</h1>

                <div className="buttons">
                    <button onClick={() => posthog?.capture('Clicked button')}>Capture event</button>
                    <button data-attr="autocapture-button">Autocapture buttons</button>
                    <button className="ph-no-capture">Ignore certain elements</button>
                </div>

                <p>Feature flag response: {JSON.stringify(result)}</p>

                <PostHogFeature flag="test" match={true}>
                    <p>
                        I only get rendered if the flag <b>test</b> resolves to <code>true</code>
                    </p>
                </PostHogFeature>
            </main>
        </>
    )
}
