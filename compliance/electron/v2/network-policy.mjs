// Native hybrid runs allow only an explicit HTTP mock origin, never a live project host.
// When the runner knows the advertised mock address, other loopback/private services are rejected too.
export function mockOrigin(host, allowedHosts = mockHostsFromEnvironment()) {
    try {
        const url = new URL(host)
        const parts = url.hostname.split('.').map(Number)
        const privateIPv4 =
            parts.length === 4 &&
            parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
            (parts[0] === 127 ||
                parts[0] === 10 ||
                (parts[0] === 192 && parts[1] === 168) ||
                (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
        if (
            url.protocol !== 'http:' ||
            !url.port ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash ||
            !(privateIPv4 || ['localhost', '[::1]'].includes(url.hostname)) ||
            (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname))
        )
            return undefined
        return url.origin
    } catch {
        return undefined
    }
}

export function mockHostsFromEnvironment() {
    return (process.env.POSTHOG_ELECTRON_MOCK_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)
}
