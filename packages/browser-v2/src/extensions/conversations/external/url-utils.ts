import { createLogger } from '../../../utils/logger'
import { window } from '../../../utils/globals'

const logger = createLogger('[ConversationsManager]')

export const RESTORE_QUERY_PARAM = 'ph_conv_restore'

/**
 * Extract hostname from a domain string (handles URLs and plain hostnames)
 */
function extractHostname(domain: string): string | null {
    let hostname = domain.replace(/^https?:\/\//, '')
    hostname = hostname.split('/')[0].split('?')[0].split(':')[0]
    return hostname || null
}

/**
 * Check if the current domain matches the allowed domains list.
 * Returns true if:
 * - domains is empty or not present (no restriction)
 * - current hostname matches any allowed domain
 */
export function isCurrentDomainAllowed(domains: string[] | undefined): boolean {
    if (!domains || domains.length === 0) {
        return true
    }

    const currentHostname = window?.location?.hostname
    if (!currentHostname) {
        return true
    }

    return domains.some((domain) => {
        const allowedHostname = extractHostname(domain)
        if (!allowedHostname) {
            return false
        }

        if (allowedHostname.startsWith('*.')) {
            const pattern = allowedHostname.slice(2)
            return currentHostname.endsWith(`.${pattern}`) || currentHostname === pattern
        }

        return currentHostname === allowedHostname
    })
}

export function getRestoreTokenFromUrl(): string | null {
    if (!window?.location?.search) {
        return null
    }

    try {
        // eslint-disable-next-line compat/compat
        const params = new URLSearchParams(window.location.search)
        const token = params.get(RESTORE_QUERY_PARAM)
        return token?.trim() || null
    } catch (error) {
        logger.warn('Failed to parse restore token from URL', error)
        return null
    }
}

export function clearRestoreTokenFromUrl(): void {
    if (!window?.location || !window?.history?.replaceState) {
        return
    }

    try {
        // eslint-disable-next-line compat/compat
        const url = new URL(window.location.href)
        url.searchParams.delete(RESTORE_QUERY_PARAM)
        const newUrl = `${url.pathname}${url.search}${url.hash}`
        window.history.replaceState(window.history.state, '', newUrl)
    } catch (error) {
        logger.warn('Failed to clear restore token from URL', error)
    }
}
