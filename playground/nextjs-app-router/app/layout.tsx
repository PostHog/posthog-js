import '@/styles/globals.css'
import { ReactNode, Suspense } from 'react'
import { PostHogPageview, Providers } from './providers'

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <Suspense>
                <PostHogPageview />
            </Suspense>

            <Providers>
                <body>{children}</body>
            </Providers>
        </html>
    )
}
