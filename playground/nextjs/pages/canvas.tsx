import Head from 'next/head'
import { useEffect, useRef } from 'react'

const random = (range: number) => Math.floor(Math.random() * range)
const width = 500
const height = 300

export default function Canvas() {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const interval = setInterval(() => {
            if (ref.current) {
                var ctx = ref.current.getContext('2d')

                ctx?.moveTo(random(width), random(height))
                ctx?.lineTo(random(width), random(height))
                ctx?.stroke()
            }
        }, 100)

        return () => clearInterval(interval)
    }, [ref])

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>PostHog Canvas test</h1>

                <p>Not currently supported due to playback challenges but nonetheless here for testing</p>

                <canvas id="myCanvas" width={width} height={height} ref={ref} />
            </main>
        </>
    )
}
