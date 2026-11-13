import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment'

export default (function () {
    if (!ExecutionEnvironment.canUseDOM) {
        return null
    }

    return {
        /** @param {{ location: { pathname: string }, previousLocation?: { pathname: string } }} route */
        onRouteUpdate({ location, previousLocation }) {
            // The SDK captures the initial pageview, including after consent is granted.
            if (previousLocation && location.pathname != previousLocation.pathname) {
                if (typeof window !== 'undefined' && typeof window.posthog !== 'undefined') {
                    window.posthog.capture('$pageview')
                }
            }
        },
    }
})()
