// @vitest-environment jsdom
import { createPostHog } from '../src'
import { localRemoteConfig } from './helpers'

it('shares default JSON configuration across flags, logs, surveys and autocapture', async () => {
    const requests: string[] = []
    const logBodies: unknown[] = []
    const client = await createPostHog({
        projectToken: 'ph_products',
        storage: false,
        navigator: false,
        capturePageview: false,
        analytics: false,
        surveys: { automaticDisplay: false },
        fetch: async (input, init) => {
            const path = new URL(String(input)).pathname
            requests.push(path)
            if (path === '/array/ph_products/config') {
                return new Response(
                    JSON.stringify({
                        ...localRemoteConfig,
                        hasFeatureFlags: true,
                        surveys: true,
                        autocapture_opt_out: false,
                        logs: { captureConsoleLogs: false },
                    })
                )
            }
            if (path === '/flags/') return new Response(JSON.stringify({ featureFlags: { remote: true } }))
            if (path === '/api/surveys/') return new Response(JSON.stringify({ surveys: [] }))
            if (path === '/i/v1/logs') {
                logBodies.push(JSON.parse(String(init?.body)))
                return new Response('{}')
            }
            throw new Error(`Unexpected request: ${path}`)
        },
    })
    try {
        await client.getRemoteConfig()
        await vi.waitFor(() => expect(client.getFeatureFlag('remote')?.enabled).toBe(true))
        const surveys = await new Promise((resolve) => client.getSurveys((values) => resolve(values)))
        expect(surveys).toEqual([])
        expect(requests).toContain('/api/surveys/')
        const captured = vi.fn()
        client.onEvent(captured)
        document.body.innerHTML = '<button>Save</button>'
        document.querySelector('button')!.click()
        expect(captured).toHaveBeenCalledWith(expect.objectContaining({ event: '$autocapture' }))
        client.captureLog({ body: 'configured products' })
        await client.flush()
        expect(logBodies).toHaveLength(1)
        expect(requests.filter((path) => path === '/array/ph_products/config')).toHaveLength(1)
    } finally {
        await client.dispose()
        document.body.innerHTML = ''
    }
})
