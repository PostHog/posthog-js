import type { MetaFunction } from '@remix-run/node'
import { useEffect, useState } from 'react'

export const meta: MetaFunction = () => {
    return [{ title: 'Media - PostHog Remix Playground' }, { name: 'description', content: 'Test base64 images' }]
}

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

    return (
        <div style={{ fontFamily: 'system-ui, sans-serif', lineHeight: '1.8', padding: '2rem' }}>
            <h1>Base64 Images</h1>
            <p>Testing for Replay image processing with different file sizes</p>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ margin: 10 }}>
                    <h3>Small PNG (~7KB)</h3>
                    <p style={{ maxWidth: '16rem' }}>400x400 base64 encoded PNG</p>
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
                    <p style={{ maxWidth: '16rem' }}>400x400 base64 encoded PNG</p>
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
                    <p style={{ maxWidth: '16rem' }}>400x400 base64 encoded PNG</p>
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
                    <p style={{ maxWidth: '16rem' }}>800x800 base64 encoded PNG</p>
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
                    <p style={{ maxWidth: '16rem' }}>1200x1200 base64 encoded PNG</p>
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
                    <p style={{ maxWidth: '16rem' }}>1600x1600 base64 encoded PNG</p>
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
        </div>
    )
}
