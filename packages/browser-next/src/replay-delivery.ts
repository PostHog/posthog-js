import type { Client } from '@posthog/browser-common'
import { gzipSync, strToU8 } from 'fflate'
import { EventBuffer } from './event-buffer'
import { Lane } from './lane'
import { createId } from './id'
import type { ReplayHostContext } from './replay-internal'

type Snapshot = { endpoint: string; json: string }

/** The recorder splits playable snapshot data; this queue bounds delivery retention independently. */
export const createReplayDelivery = (client: Client, host: ReplayHostContext) => {
    const buffer = new EventBuffer<Snapshot>(
        100,
        () => client.logger.warn('Replay delivery buffer overflow'),
        8 * 1024 * 1024,
        3_600_000
    )
    const lane = new Lane(buffer, (error) => client.logger.error('Replay delivery failed', error))
    let compression: 'gzip-js' | 'base64' | undefined = 'gzip-js'
    const configSubscription = client.onRemoteConfig((result) => {
        if (result.ok) {
            const supported = result.config.supportedCompression
            compression = supported?.includes('gzip-js')
                ? 'gzip-js'
                : supported?.includes('base64')
                  ? 'base64'
                  : undefined
        }
    })
    const urlFor = (endpoint: string): URL => {
        if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error('Invalid replay endpoint')
        const base = new URL(`${host.runtime[0].api}/`)
        const url = new URL(`${host.runtime[0].api}${endpoint}`)
        if (url.origin !== base.origin) throw new Error('Replay endpoint must use the configured host')
        url.searchParams.set('sent_at', String(Date.now()))
        return url
    }
    const encode = (snapshot: Snapshot, teardown = false) => {
        const url = urlFor(snapshot.endpoint)
        const json = `[${snapshot.json}]`
        if (compression === 'gzip-js') {
            const data = gzipSync(strToU8(json), { mtime: 0 })
            return { url, body: new Blob([new Uint8Array(data)], { type: 'text/plain' }) }
        }
        if (compression === 'base64' || teardown) {
            const data = strToU8(json)
            let binary = ''
            for (const byte of data) binary += String.fromCharCode(byte)
            url.searchParams.set('compression', 'base64')
            return {
                url,
                body: new Blob([`data=${encodeURIComponent(btoa(binary))}`], {
                    type: 'application/x-www-form-urlencoded',
                }),
            }
        }
        return { url, body: new Blob([json], { type: 'application/json' }) }
    }
    lane.attach({
        batchSize: 1,
        flushAt: 20,
        flushInterval: 3000,
        canDeliver: () => host.canDeliver() && host.runtime[3]?.onLine !== false,
        deliver: async (snapshots, context) => {
            const snapshot = snapshots[0]!
            if (!context.canContinue() || !host.canDeliver()) return
            const { url, body } = encode(snapshot)
            const status = await new Promise<number>((resolve) => {
                let settled = false
                let timer: ReturnType<typeof setTimeout> | undefined
                const controller = typeof AbortController === 'function' ? new AbortController() : undefined
                const finish = (status: number) => {
                    if (settled) return
                    settled = true
                    if (timer !== undefined) clearTimeout(timer)
                    context.signal?.removeEventListener('abort', cancel)
                    resolve(status)
                }
                const cancel = () => {
                    try {
                        controller?.abort()
                    } finally {
                        finish(0)
                    }
                }
                try {
                    // oxlint-disable-next-line posthog-js/no-add-event-listener
                    context.signal?.addEventListener('abort', cancel, { once: true })
                    timer = setTimeout(cancel, 60_000)
                    const fetch = host.runtime[2]
                    if (!fetch || !context.canContinue() || !host.canDeliver()) return cancel()
                    void fetch(url, {
                        method: 'POST',
                        credentials: 'omit',
                        body,
                        ...(controller ? { signal: controller.signal } : {}),
                    }).then(
                        (response) => finish(response.status),
                        () => finish(0)
                    )
                } catch {
                    cancel()
                }
            })
            if (status === 0 || status === 408 || status === 429 || status >= 500) return { retry: snapshots }
        },
        teardown: (snapshots, maxBytes) => {
            for (const snapshot of snapshots) {
                const { url, body } = encode(snapshot, true)
                if (body.size > maxBytes || !host.canDeliver()) break
                maxBytes -= body.size
                let accepted = false
                try {
                    accepted = host.runtime[3]?.sendBeacon?.(String(url), body) ?? false
                } catch {
                    /* Fetch fallback. */
                }
                if (!accepted && host.canDeliver()) {
                    void host.runtime[2]?.(url, { method: 'POST', credentials: 'omit', body, keepalive: true }).catch(
                        () => {}
                    )
                }
            }
        },
    })
    return {
        capture(endpoint: string, properties: Record<string, unknown>) {
            if (!host.canDeliver()) return
            const json = JSON.stringify({
                event: '$snapshot',
                uuid: createId(),
                timestamp: new Date().toISOString(),
                properties: { ...properties, token: client.projectToken, distinct_id: client.distinctId },
            })
            if (!host.canDeliver()) return
            buffer.enqueue({ endpoint, json }, strToU8(json).byteLength)
        },
        flush: () => lane.flush(),
        purge: () => buffer.purge(),
        teardown: () => lane.teardown(Math.floor(64 * 1024 * 0.8)),
        online: () => lane.retryNow(),
        offline: () => lane.pause(),
        async dispose() {
            configSubscription.dispose()
            await lane.dispose()
        },
    }
}
