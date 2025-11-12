import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'

function generateBase64PNG(width: number, height: number, complexity: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`)
    gradient.addColorStop(1, `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    for (let i = 0; i < complexity; i++) {
        ctx.fillStyle = `rgba(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255},${Math.random()})`
        ctx.fillRect(Math.random() * width, Math.random() * height, Math.random() * 100, Math.random() * 100)
    }

    ctx.font = 'bold 48px Arial'
    ctx.fillStyle = 'white'
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 3
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const dataUrl = canvas.toDataURL('image/png')
    const sizeKB = Math.round((dataUrl.length * 0.75) / 1024)
    ctx.strokeText(`${sizeKB}KB`, width / 2, height / 2)
    ctx.fillText(`${sizeKB}KB`, width / 2, height / 2)

    return canvas.toDataURL('image/png')
}

export default function Media() {
    const hlsVideoEl = useRef<HTMLVideoElement>(null)
    const [images, setImages] = useState<Record<string, string>>({})

    useEffect(() => {
        setImages({
            small: generateBase64PNG(400, 400, 0),
            medium: generateBase64PNG(400, 400, 200),
            large: generateBase64PNG(400, 400, 1000),
            veryLarge: generateBase64PNG(800, 800, 1000),
            extraLarge: generateBase64PNG(1200, 1200, 1000),
            huge: generateBase64PNG(1600, 1600, 1000),
        })
    }, [])

    useEffect(() => {
        const videoEl = hlsVideoEl.current
        if (videoEl) {
            if (Hls.isSupported()) {
                const hls = new Hls()
                hls.loadSource('https://d2zihajmogu5jn.cloudfront.net/big-buck-bunny/master.m3u8')
                hls.attachMedia(videoEl)
            } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                videoEl.src = 'https://d2zihajmogu5jn.cloudfront.net/big-buck-bunny/master.m3u8'
            }
        }
    }, [hlsVideoEl])

    return (
        <>
            <h1>Images</h1>
            <p>Useful testing for Replay handling image elements</p>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ margin: 10 }}>
                    <h3>Image (no overload)</h3>
                    <p className="max-w-64">
                        No overload means we can see the image, but it's not as detailed as if we were blocking it
                    </p>
                    <img src="https://cataas.com/cat?width=200" />
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Image (ignored)</h3>
                    <p className="max-w-64">
                        Ignoring only affects input elements, so we can still see the image even though it matches
                    </p>
                    <img className="ph-ignore-image" src="https://cataas.com/cat?width=200" />
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Image (blocked)</h3>
                    <p className="max-w-64">
                        Blocking only affects images that match the selector, so we can not see the image even though it
                        matches
                    </p>
                    <img className="ph-block-image" src="https://cataas.com/cat?width=200" />
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Image (blocked - default class)</h3>
                    <p className="max-w-64">
                        Blocking only affects images that match the default blockClass, so we can not see the image even
                        though it matches
                    </p>
                    <img className="ph-no-capture" src="https://cataas.com/cat?width=200" />
                </div>
            </div>

            <h1>Base64 Images</h1>
            <p>Testing for Replay image processing with different file sizes</p>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ margin: 10 }}>
                    <h3>Small PNG (~7KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded PNG</p>
                    {images.small && (
                        <img
                            src={images.small}
                            alt="Small test image"
                            style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                        />
                    )}
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Medium PNG (~50KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded PNG</p>
                    {images.medium && (
                        <img
                            src={images.medium}
                            alt="Medium test image"
                            style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                        />
                    )}
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Large PNG (~200KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded PNG</p>
                    {images.large && (
                        <img
                            src={images.large}
                            alt="Large test image"
                            style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                        />
                    )}
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Very Large (~500KB)</h3>
                    <p className="max-w-64">800x800 base64 encoded PNG</p>
                    {images.veryLarge && (
                        <img
                            src={images.veryLarge}
                            alt="Very large test image"
                            style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                        />
                    )}
                    <p style={{ fontSize: '12px', color: '#666' }}>800x800px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Extra Large (~999KB)</h3>
                    <p className="max-w-64">1200x1200 base64 encoded PNG</p>
                    {images.extraLarge && (
                        <img
                            src={images.extraLarge}
                            alt="Extra large test image"
                            style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                        />
                    )}
                    <p style={{ fontSize: '12px', color: '#666' }}>1200x1200px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Huge (~1.5MB)</h3>
                    <p className="max-w-64">1600x1600 base64 encoded PNG</p>
                    {images.huge && (
                        <img
                            src={images.huge}
                            alt="Huge test image"
                            style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                        />
                    )}
                    <p style={{ fontSize: '12px', color: '#666' }}>1600x1600px (displayed at 200x200)</p>
                </div>
            </div>

            <h1>Video</h1>
            <p>Useful testing for Replay handling video elements</p>
            <div style={{ margin: 10 }}>
                <h3>Video</h3>
                <video controls={true} style={{ width: 500 }}>
                    <source src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" />
                </video>
            </div>

            <div style={{ margin: 10 }}>
                <h3>HLS Video</h3>
                <video
                    ref={hlsVideoEl}
                    controls={true}
                    style={{ width: 500 }}
                    hls-src="https://d2zihajmogu5jn.cloudfront.net/big-buck-bunny/master.m3u8"
                />
            </div>

            <div style={{ margin: 10 }}>
                <h3>Audio</h3>
                <audio controls={true}>
                    <source
                        src="https://github.com/rafaelreis-hotmart/Audio-Sample-files/raw/master/sample.mp3"
                        type="audio/mp3"
                    />
                </audio>
            </div>
        </>
    )
}
