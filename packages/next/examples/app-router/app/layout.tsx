import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PostHogProvider, PostHogPageView } from '@posthog/next'
import { Nav } from './components/Nav'
import { ConsentBanner } from './components/ConsentBanner'
import './globals.css'

export const metadata: Metadata = {
    title: '@posthog/next App Router Example',
    description: 'Example Next.js App Router project demonstrating @posthog/next features',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-gray-50 text-gray-900 min-h-screen">
                <PostHogProvider
                    apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}
                    options={{ api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST }}
                    bootstrapFlags
                >
                    <Suspense fallback={null}>
                        <PostHogPageView />
                    </Suspense>
                    <Nav />
                    <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
                    <ConsentBanner />
                </PostHogProvider>
            </body>
        </html>
    )
}
