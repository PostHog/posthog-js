import { createPostHog as createCorePostHog } from '../src/composition/npm/core'
import { createPostHog as createRootPostHog } from '../src/composition/npm'
import { createAnalyticsExtension } from '../src/products/analytics/analytics-buffer'
import type {
    BrowserFetch,
    CorePostHogOptions,
    IPostHog,
    PostHogOptions,
    RemoteConfig,
    StorageLike,
} from '../src/core/types'
import type { IPostHogInternal } from '../src/core/context/browser-client'

const internalHosts = new WeakMap<IPostHog, IPostHogInternal>()

/** Install a probe extension to exercise transport only through its scoped setup capability. */
export const withInternalHost =
    <Options extends CorePostHogOptions>(create: (options: Options) => Promise<IPostHog>) =>
    async (options: Options): Promise<IPostHog> => {
        let host: IPostHogInternal | undefined
        const client = await create({
            ...options,
            extensions: [
                ...(options?.extensions ?? []),
                {
                    name: 'request-probe',
                    setup: (scopedHost) => {
                        host = scopedHost
                    },
                },
            ],
        })
        if (host) internalHosts.set(client, host)
        return client
    }

export const internalHost = (client: IPostHog): IPostHogInternal => {
    const host = internalHosts.get(client)
    if (!host) throw new Error('Expected request-probe setup to provide an internal host')
    return host
}

/** Explicit buffer-only composition for state tests that do not exercise delivery or product selection. */
export const withBufferedAnalytics = (options: PostHogOptions): PostHogOptions => {
    const extensions = [...(options?.extensions ?? [])]
    if (!extensions.some((extension) => extension.name === 'analytics')) extensions.unshift(createAnalyticsExtension())
    return { ...options, extensions }
}

export const createBufferedPostHog = (options: CorePostHogOptions) => createCorePostHog(withBufferedAnalytics(options))
export const createBufferedRootPostHog = (options: PostHogOptions) => createRootPostHog(withBufferedAnalytics(options))

export const localRemoteConfig: RemoteConfig = {
    supportedCompression: [],
    toolbarParams: {},
    toolbarVersion: 'toolbar',
    isAuthenticated: false,
    siteApps: [],
}

export const createRemoteConfigFetch =
    (config: () => Promise<RemoteConfig | undefined>, fallback?: BrowserFetch): BrowserFetch =>
    async (input, init) => {
        if (new URL(String(input)).pathname.endsWith('/config')) {
            const result = await config()
            return new Response(JSON.stringify(result), { status: result ? 200 : 500 })
        }
        if (fallback) return fallback(input, init)
        throw new Error(`Unexpected request: ${String(input)}`)
    }

export class MemoryStorage implements StorageLike {
    readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }

    removeItem(key: string): void {
        this.values.delete(key)
    }
}

export interface SentRequest {
    url: URL
    init: RequestInit
    body: Record<string, unknown> | undefined
}

export const createFetch =
    (requests: SentRequest[], status = 200): BrowserFetch =>
    async (input, init = {}) => {
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
        requests.push({ url: new URL(String(input)), init, body })
        return new Response('{}', { status, headers: { 'Content-Type': 'application/json' } })
    }

/** Require an installed product before exercising its behavior. */
export const requireInstalledExtension = <T>(extension: T | undefined): T => {
    if (extension === undefined) throw new Error('Expected extension to be installed')
    return extension
}
