'use strict'

const Module = require('module')

const BROWSERSTACK_HOSTS = new Set(['api.browserstack.com', 'hub-cloud.browserstack.com'])
const originalLoad = Module._load

function isBrowserStackRequest(url) {
    const target = typeof url === 'string' ? url : url && url.url

    if (!target) {
        return false
    }

    try {
        return BROWSERSTACK_HOSTS.has(new URL(target).hostname)
    } catch (_) {
        return false
    }
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
        if (isBrowserStackRequest(url)) {
            options = {
                ...options,
                compress: false,
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
