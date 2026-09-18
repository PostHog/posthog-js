import type { BrowserFetch, RemoteConfig, StorageLike } from '../src/core'

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
