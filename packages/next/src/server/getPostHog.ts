import 'server-only'

import type { PostHogOptions, IPostHog } from 'posthog-node'
import { cookies } from 'next/headers'
import { getOrCreateNodeClient } from './nodeClientCache'
import { readPostHogCookie, cookieStateToProperties } from '../shared/cookie'
import { resolveApiKey } from '../shared/config'

export async function getPostHog(apiKey?: string, options?: Partial<PostHogOptions>): Promise<IPostHog> {
    const resolvedApiKey = resolveApiKey(apiKey)
    const host = options?.host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const resolvedOptions = host ? { ...options, host } : options
    const client = getOrCreateNodeClient(resolvedApiKey, resolvedOptions)
    const state = readPostHogCookie(await cookies(), resolvedApiKey)
    const properties = cookieStateToProperties(state)

    client.enterContext({ distinctId: state?.distinctId, properties })
    return client
}
