export async function createCompatibilityContext(browser, engine, origin, options = {}) {
    // Do not bypass other loopback origins or intercept native Chromium unload traffic.
    const context = await browser.newContext({ ...options, proxy: { server: origin } })
    // macOS WebKit can bypass its HTTP proxy for TLS; the fixture itself uses HTTP.
    if (engine === 'webkit') await context.route('https://**', (route) => route.abort('blockedbyclient'))
    return context
}
