import { isUndefined } from '@posthog/core'

export function getCoreIntegrity(script: Element): string | null | undefined {
    const value = script.getAttribute('data-core-integrity')?.trim()
    if (isUndefined(value)) {
        return undefined
    }
    return /^sha384-[A-Za-z0-9+/]{64}$/.test(value) ? value : null
}

export function getSDKScriptURL(url: HTMLAnchorElement): string {
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    url.pathname = directory + 'array.js'
    url.search = ''
    url.hash = ''
    return url.href
}
