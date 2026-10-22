const surveyAsset = /\/surveys(?:-[^.]+)?\.js$/

export function assertLoaderProof(scenario, comparison, requests, loading = {}) {
    if (!['delayed-loading', 'version-fallback'].includes(scenario)) return undefined
    const successful = requests.filter((request) => surveyAsset.test(request.path) && request.status === 200)
    if (!successful.length) throw new Error('No successful survey extension request')
    if (scenario === 'delayed-loading') {
        if (!loading.pendingRequest || loading.renderedBeforeRelease !== false || !loading.renderedAfterRelease)
            throw new Error('Missing delayed-extension loading evidence')
        return 'held-request-then-ready'
    }
    if (comparison === 'historical') {
        if (!successful.some((request) => /^\/static\/[^/]+\.js$/.test(request.path)))
            throw new Error('Historical native legacy path was not loaded')
        return 'legacy-path-only'
    }
    const fallback = requests.some((request, index) => {
        if (
            request.status !== 404 ||
            !/^\/static\/[^/]+\/[^/]+\.js$/.test(request.path) ||
            !surveyAsset.test(request.path)
        )
            return false
        const legacy = '/static/' + request.path.split('/').at(-1)
        return requests.slice(index + 1).some((next) => next.path === legacy && next.status === 200)
    })
    if (!fallback || !loading.renderedAfterRelease)
        throw new Error('Missing versioned failure, successful legacy fallback or survey readiness')
    return 'versioned-404-then-legacy-ready'
}
