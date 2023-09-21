import Head from 'next/head'
import React, { useEffect, useRef } from 'react'

const draw = (ctx: any, frameCount: any) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(50, 100, 20 * Math.sin(frameCount * 0.05) ** 2, 0, 2 * Math.PI)
    ctx.fill()
}

const CanvasExample = (props: any) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const context = canvas.getContext('2d')
        let frameCount = 0
        let animationFrameId: number

        //Our draw came here
        const render = () => {
            frameCount++
            draw(context, frameCount)
            animationFrameId = window.requestAnimationFrame(render)
        }
        render()

        return () => {
            window.cancelAnimationFrame(animationFrameId)
        }
    }, [])

    return <canvas ref={canvasRef} {...props} />
}

export default function Canvas() {
    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>Canvas</h1>

                <CanvasExample />
            </main>
        </>
    )
}
