import { isArray, isString } from '@posthog/core'
import { each, eachArray } from '@posthog/browser-common/utils/general-utils'

export {
    addEventListener,
    each,
    eachArray,
    entries,
    extend,
    find,
    isToolbarInstance,
    migrateConfigField,
    safewrap,
    safewrapClass,
    stripEmptyProperties,
    trySafe,
} from '@posthog/browser-common/utils/general-utils'

/**
 * Deep copies an object.
 * It handles cycles by replacing all references to them with `undefined`
 * Also supports customizing native values
 *
 * @param value
 * @param customizer
 * @returns {{}|undefined|*}
 */
function deepCircularCopy<T extends Record<string, any> = Record<string, any>>(
    value: T,
    customizer?: <K extends keyof T = keyof T>(value: T[K], key?: K) => T[K]
): T | undefined {
    const COPY_IN_PROGRESS_SET = new Set()

    function internalDeepCircularCopy(value: T, key?: string): T | undefined {
        if (value !== Object(value)) return customizer ? customizer(value as any, key) : value // primitive value

        if (COPY_IN_PROGRESS_SET.has(value)) return undefined
        COPY_IN_PROGRESS_SET.add(value)
        let result: T

        if (isArray(value)) {
            result = [] as any as T
            eachArray(value, (it) => {
                result.push(internalDeepCircularCopy(it))
            })
        } else {
            result = {} as T
            each(value, (val, key) => {
                if (!COPY_IN_PROGRESS_SET.has(val)) {
                    ;(result as any)[key] = internalDeepCircularCopy(val, key)
                }
            })
        }
        return result
    }
    return internalDeepCircularCopy(value)
}

export function _copyAndTruncateStrings<T extends Record<string, any> = Record<string, any>>(
    object: T,
    maxStringLength: number
): T {
    return deepCircularCopy(object, (value: any) => {
        if (isString(value)) {
            return (value as string).slice(0, maxStringLength)
        }
        return value
    }) as T
}

// NOTE: Update PostHogConfig docs if you change this list
// We will not try to catch all bullets here, but we should make an effort to catch the most common ones
// You should be highly against adding more to this list, because ultimately customers can configure
// their `cross_subdomain_cookie` setting to anything they want.
const EXCLUDED_FROM_CROSS_SUBDOMAIN_COOKIE = ['herokuapp.com', 'vercel.app', 'netlify.app']
export function isCrossDomainCookie(documentLocation: Location | undefined) {
    const hostname = documentLocation?.hostname

    if (!isString(hostname)) {
        return false
    }
    // split and slice isn't a great way to match arbitrary domains,
    // but it's good enough for ensuring we only match herokuapp.com when it is the TLD
    // for the hostname
    const lastTwoParts = hostname.split('.').slice(-2).join('.')

    for (const excluded of EXCLUDED_FROM_CROSS_SUBDOMAIN_COOKIE) {
        if (lastTwoParts === excluded) {
            return false
        }
    }

    return true
}
