'use client'

import Image from 'next/image'
import { PostHogCaptureOnViewed } from '@posthog/react'

const catImages = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1,
    url: `https://cataas.com/cat?width=400&height=300&${i + 1}`,
    alt: `Cat ${i + 1}`,
}))

export default function Home() {
    return (
        <main style={{ minHeight: '100vh', padding: '2rem', backgroundColor: '#f5f5f5' }}>
            <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                <h1
                    style={{
                        fontSize: '2.5rem',
                        fontWeight: 'bold',
                        marginBottom: '1rem',
                        color: '#333',
                    }}
                >
                    Cat Gallery - PostHog React Demo
                </h1>
                <p style={{ fontSize: '1.125rem', marginBottom: '2rem', color: '#666' }}>
                    Scroll down to see the cat gallery. When it comes into view, PostHog will track the event and
                    display it in the top right corner.
                </p>

                <div style={{ height: '50vh', backgroundColor: '#e0e0e0', marginBottom: '2rem', padding: '2rem' }}>
                    <h2 style={{ fontSize: '1.5rem', color: '#555' }}>Scroll down to see the gallery...</h2>
                </div>

                <PostHogCaptureOnViewed
                    name="cat-gallery"
                    properties={{ gallery_size: catImages.length, gallery_type: 'cats' }}
                    trackAllChildren
                    observerOptions={{ threshold: 0.1 }}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                        gap: '1.5rem',
                        padding: '2rem',
                        backgroundColor: 'white',
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    }}
                >
                    {catImages.map((cat, index) => (
                        <div
                            key={cat.id}
                            style={{
                                position: 'relative',
                                aspectRatio: '4/3',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                backgroundColor: '#ddd',
                            }}
                        >
                            <Image
                                src={cat.url}
                                alt={cat.alt}
                                loading={index < 5 ? 'eager' : 'lazy'}
                                fill
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                style={{ objectFit: 'cover' }}
                            />
                        </div>
                    ))}
                </PostHogCaptureOnViewed>

                <PostHogCaptureOnViewed
                    name="test-element"
                    properties={{ test: true }}
                    observerOptions={{ threshold: 0.1 }}
                    style={{
                        padding: '2rem',
                        backgroundColor: '#00b894',
                        color: 'white',
                        height: '50vh',
                        marginTop: '2rem',
                    }}
                >
                    <p style={{ color: '#666' }}>End of page</p>
                </PostHogCaptureOnViewed>
            </div>
        </main>
    )
}
