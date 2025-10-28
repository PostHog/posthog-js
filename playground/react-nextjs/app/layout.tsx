import type { Metadata } from 'next'
import { PHProvider } from './providers'
import './globals.css'

export const metadata: Metadata = {
    title: 'PostHog InView Playground',
    description: 'Test PostHog InView component with a cat gallery',
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en">
            <body>
                <PHProvider>{children}</PHProvider>
            </body>
        </html>
    )
}
