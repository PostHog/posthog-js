// MSW v1 cannot intercept native Node.js fetch (added in Node 18+).
// Workaround: delete the global fetch so jsdom falls back to XMLHttpRequest,
// which MSW v1 CAN intercept via its node interceptor.
// @ts-expect-error - intentionally deleting to force XHR fallback
delete globalThis.fetch
// @ts-expect-error
delete globalThis.Request
// @ts-expect-error
delete globalThis.Response
// @ts-expect-error
delete globalThis.Headers

// Ensure localStorage has proper function methods in vitest's jsdom
// (vitest's SSR module runner can interfere with jsdom's localStorage prototype)
if (typeof window !== 'undefined' && window.localStorage) {
    const store: Record<string, string> = {}
    const localStorageMock = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
            store[key] = String(value)
        },
        removeItem: (key: string) => {
            delete store[key]
        },
        clear: () => {
            Object.keys(store).forEach((key) => delete store[key])
        },
        get length() {
            return Object.keys(store).length
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
    }
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
}
