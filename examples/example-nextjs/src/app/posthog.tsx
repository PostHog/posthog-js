'use client'

import { PostHogConfig } from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

const posthogConfig: Partial<PostHogConfig> = {
  api_host: 'http://localhost:8010',
  debug: process.env.NODE_ENV === 'development',
}

export default function PHProvider({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY!} options={posthogConfig}>
      {children}
    </PostHogProvider>
  )
}
