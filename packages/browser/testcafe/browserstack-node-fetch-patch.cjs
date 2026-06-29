'use strict'

const Module = require('module')

const BROWSERSTACK_BROWSER_LIST_URL = 'https://api.browserstack.com/automate/browsers.json'
const originalLoad = Module._load

function isBrowserStackBrowserListRequest(url) {
    const target = typeof url === 'string' ? url : url && url.url

    return target === BROWSERSTACK_BROWSER_LIST_URL || target?.startsWith(`${BROWSERSTACK_BROWSER_LIST_URL}?`)
}

function withIdentityEncoding(fetch, headers) {
    if (headers?.set) {
        const nextHeaders = new fetch.Headers(headers)
        nextHeaders.set('Accept-Encoding', 'identity')
        return nextHeaders
    }

    return {
        ...headers,
        'Accept-Encoding': 'identity',
    }
}

function patchNodeFetch(fetch) {
    if (fetch.__posthogBrowserStackFetchPatch) {
        return fetch
    }

    const patchedFetch = (url, options = {}) => {
        if (isBrowserStackBrowserListRequest(url)) {
            options = {
                ...options,
                headers: withIdentityEncoding(fetch, options.headers),
            }
        }

        return fetch(url, options)
    }

    Object.assign(patchedFetch, fetch)
    Object.defineProperty(patchedFetch, '__posthogBrowserStackFetchPatch', { value: true })

    return patchedFetch
}

Module._load = function patchedLoad(request, parent, isMain) {
    const loadedModule = originalLoad.apply(this, arguments)

    if (request === 'node-fetch') {
        return patchNodeFetch(loadedModule)
    }

    return loadedModule
}
