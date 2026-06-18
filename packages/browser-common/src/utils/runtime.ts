import { isFunction } from '@posthog/core'

type RuntimeValue<T> = T | (() => T)

type KeyValueReader = {
    _get: (key: string) => unknown
}

export type BrowserCommonRuntimeConfig = {
    debug?: RuntimeValue<boolean | undefined>
    libName?: RuntimeValue<string | undefined>
    libVersion?: RuntimeValue<string | undefined>
    sdkDistChannel?: RuntimeValue<string | undefined>
    cookieStore?: RuntimeValue<KeyValueReader | undefined>
    localStore?: RuntimeValue<KeyValueReader | undefined>
}

const runtimeConfig: BrowserCommonRuntimeConfig = {}

export function configureBrowserCommon(config: BrowserCommonRuntimeConfig): void {
    Object.assign(runtimeConfig, config)
}

function resolveRuntimeValue<T>(value: RuntimeValue<T> | undefined): T | undefined {
    return isFunction(value) ? (value as () => T)() : value
}

export function getBrowserCommonRuntime(): {
    debug: boolean
    libName: string
    libVersion: string
    sdkDistChannel: string | undefined
    cookieStore: KeyValueReader | undefined
    localStore: KeyValueReader | undefined
} {
    return {
        debug: !!resolveRuntimeValue(runtimeConfig.debug),
        libName: resolveRuntimeValue(runtimeConfig.libName) ?? 'web',
        libVersion: resolveRuntimeValue(runtimeConfig.libVersion) ?? '0.0.0',
        sdkDistChannel: resolveRuntimeValue(runtimeConfig.sdkDistChannel),
        cookieStore: resolveRuntimeValue(runtimeConfig.cookieStore),
        localStore: resolveRuntimeValue(runtimeConfig.localStore),
    }
}
