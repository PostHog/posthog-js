// @vitest-environment jsdom
import { createPostHog } from '../src/composition/npm'
import { localRemoteConfig } from './helpers'

it('activates real autocapture from remote config and captures DOM clicks through the client', async () => {
    document.body.innerHTML = '<button>Save</button>'
    const client = await createPostHog({
        projectToken: 'ph_autocapture_acquisition',
        storage: false,
        navigator: false,
        fetch: false,
        capturePageview: false,
        flags: false,
        logs: false,
        surveys: false,
        analytics: { flushInterval: 0 },
        remoteConfig: { ...localRemoteConfig, autocapture_opt_out: false },
    })
    try {
        expect(client.autocapture).toBeDefined()
        const captured = vi.fn()
        client.onEvent(captured)
        document.querySelector('button')!.click()
        expect(captured).toHaveBeenCalledOnce()
        expect(captured).toHaveBeenCalledWith(expect.objectContaining({ event: '$autocapture' }))
    } finally {
        await client.shutdown(0)
        document.body.innerHTML = ''
    }
})
