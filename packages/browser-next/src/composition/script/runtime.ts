import { createPostHog } from '../npm/index'
import { createLogger } from '../../platform/logger'
import { group, groupIdentify, resetGroups } from '../../products/analytics/groups'
import {
    alias,
    createPersonProfile,
    setInternalOrTestUser,
    setPersonProperties,
    unsetPersonProperties,
} from '../../products/analytics/person'
import type { IPostHog, PostHogOptions } from '../../core/types'

const installation = Symbol.for('posthog.browser.snippet')

/**
 * Script users have no module imports, so the global client also carries the npm package's
 * group and person functions as methods.
 */
const scriptMethods = {
    group,
    groupIdentify,
    resetGroups,
    alias,
    createPersonProfile,
    setPersonProperties,
    unsetPersonProperties,
    setInternalOrTestUser,
} as const

export type ScriptPostHog = IPostHog & {
    [Name in keyof typeof scriptMethods]: (typeof scriptMethods)[Name] extends (
        posthog: IPostHog,
        ...args: infer Args
    ) => infer Result
        ? (...args: Args) => Result
        : never
}

const withScriptMethods = (client: IPostHog): ScriptPostHog => {
    for (const [name, method] of Object.entries(scriptMethods)) {
        Object.defineProperty(client, name, {
            configurable: true,
            value: (...args: unknown[]) =>
                (method as (posthog: IPostHog, ...rest: unknown[]) => unknown)(client, ...args),
        })
    }
    return client as ScriptPostHog
}
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
        target.posthog = withScriptMethods(client)
        target.dispatchEvent(new CustomEvent('posthog:ready', { detail: client }))
    } catch {
        // Never expose the script URL, token, or customer-controlled error text.
        createLogger('PostHog script', true).error('initialization failed')
    } finally {
        if (reserved) delete target[installation]
    }
}
