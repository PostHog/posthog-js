import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react'
import { PHProvider } from './providers'

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <Meta />
                <Links />
            </head>
            <body>
                <PHProvider>
                    {children}
                    <ScrollRestoration />
                    <Scripts />
                </PHProvider>
            </body>
        </html>
    )
}

export default function App() {
    return <Outlet />
}
