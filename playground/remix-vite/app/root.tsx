import { json, Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react'
import './tailwind.css'
import { PostHogProvider } from './PostHogProvider'

export async function loader() {
    return json({
        PUBLIC_POSTHOG_KEY: process.env.PUBLIC_POSTHOG_KEY,
        PUBLIC_POSTHOG_HOST: process.env.PUBLIC_POSTHOG_HOST,
    })
}

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
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    )
}

export default function App() {
    const { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } = useLoaderData<typeof loader>()
    return (
        <PostHogProvider apiKey={PUBLIC_POSTHOG_KEY} options={{ api_host: PUBLIC_POSTHOG_HOST }}>
            <Outlet />
        </PostHogProvider>
    )
}
