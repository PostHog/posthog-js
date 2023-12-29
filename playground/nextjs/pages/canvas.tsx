import React from 'react'
import Head from 'next/head'
import { useEffect, useRef } from 'react'

export default function Home() {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        if (ref.current) {
            const canvas = ref.current
            const context = canvas.getContext('2d')

            if (canvas && context) {
                const numStars = 1000
                const radius = 1
                let focalLength = canvas.width

                let centerX = 0
                let centerY = 0

                let stars: { x: number; y: number; z: number }[] = []
                let star = null
                let i = 0

                let animate = false

                const executeFrame = () => {
                    if (animate) requestAnimationFrame(executeFrame)
                    moveStars()
                    drawStars()
                }

                const initializeStars = () => {
                    centerX = canvas.width / 2
                    centerY = canvas.height / 2

                    stars = []
                    for (i = 0; i < numStars; i++) {
                        star = {
                            x: Math.random() * canvas.width,
                            y: Math.random() * canvas.height,
                            z: Math.random() * canvas.width,
                        }
                        stars.push(star)
                    }
                }

                const moveStars = () => {
                    for (i = 0; i < numStars; i++) {
                        star = stars[i]
                        star.z--

                        if (star.z <= 0) {
                            star.z = canvas.width
                        }
                    }
                }

                const drawStars = () => {
                    let pixelX = 0
                    let pixelY = 0
                    let pixelRadius = 0
                    // Resize to the screen
                    if (canvas.width != window.innerWidth || canvas.width != window.innerWidth) {
                        canvas.width = window.innerWidth
                        canvas.height = window.innerHeight
                        initializeStars()
                    }

                    context.fillStyle = 'black'
                    context.fillRect(0, 0, canvas.width, canvas.height)
                    context.fillStyle = 'white'
                    for (i = 0; i < numStars; i++) {
                        star = stars[i]

                        pixelX = (star.x - centerX) * (focalLength / star.z)
                        pixelX += centerX
                        pixelY = (star.y - centerY) * (focalLength / star.z)
                        pixelY += centerY
                        pixelRadius = radius * (focalLength / star.z)

                        context.beginPath()
                        context.arc(pixelX, pixelY, pixelRadius, 0, 2 * Math.PI)
                        context.fill()
                    }
                }

                canvas.addEventListener('mousemove', function (e) {
                    focalLength = e.x
                })

                // Kick off the animation when the mouse enters the canvas
                canvas.addEventListener('mouseover', function () {
                    animate = true
                    executeFrame()
                })

                // Pause animation when the mouse exits the canvas
                canvas.addEventListener('mouseout', function () {
                    // mouseDown = false
                    animate = false
                })

                initializeStars()
                // Draw the first frame to start animation
                executeFrame()
            }
        }
    }, [])

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>Canvas</h1>

                <canvas ref={ref} style={{ width: '50%', height: '50%' }}></canvas>
            </main>
        </>
    )
}
