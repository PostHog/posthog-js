import { createPostHog } from '../src/index'
import { createLogger } from '../src/logger'
import type { PostHogOptions } from '../src/types'

const installation = Symbol.for('posthog.browser.snippet')
type SnippetWindow = Window & { posthog?: unknown; [installation]?: boolean }

/** Query options are deliberately limited to primitives; omitted options retain factory defaults. */
export function parseSnippetOptions(scriptUrl: string): PostHogOptions {
    const query = new URL(scriptUrl).searchParams
    const projectToken = query.get('projectToken')?.trim()
    if (!projectToken) throw new Error('Missing projectToken')
    const options: PostHogOptions = { projectToken }
    const apiHost = query.get('apiHost')
    if (apiHost !== null) {
        const url = new URL(apiHost)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('Invalid apiHost')
        }
        options.apiHost = apiHost
    }
    for (const key of ['capturePageview', 'optOutByDefault', 'debug', 'disableBotDetection'] as const) {
        const value = query.get(key)
        if (value === null) continue
        if (value !== 'true' && value !== 'false') throw new Error('Invalid boolean option')
        options[key] = value === 'true'
    }
    for (const key of ['storage', 'flags', 'logs', 'surveys', 'autocapture'] as const) {
        if (!query.has(key)) continue
        if (query.get(key) !== 'false') throw new Error('Invalid disable option')
        options[key] = false
    }
    return options
}

export async function startSnippet(scriptUrl: string, target: SnippetWindow): Promise<void> {
    if ('posthog' in target || target[installation]) return
    let reserved = false
    try {
        const options = parseSnippetOptions(scriptUrl)
        target[installation] = reserved = true
        const client = await createPostHog(options)
        // Another installer may claim the global while optional modules initialize.
        if ('posthog' in target) {
            await client.dispose()
            return
        }
        target.posthog = client
        target.dispatchEvent(new CustomEvent('posthog:ready', { detail: client }))
    } catch {
        // Never expose the script URL, token, or customer-controlled error text.
        createLogger('PostHog script', true).error('initialization failed')
    } finally {
        if (reserved) delete target[installation]
    }
}
