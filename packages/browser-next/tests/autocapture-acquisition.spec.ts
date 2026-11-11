// @vitest-environment jsdom
import { createPostHog } from '../src'
import { localRemoteConfig, requireInstalledExtension } from './helpers'

const loading = vi.hoisted(() => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((resolve) => {
        release = resolve
    })
    const requested = new Promise<void>((resolve) => {
        started = resolve
    })
    return { pending, requested, release: () => release(), started: () => started() }
})

vi.mock('../src/automatic-analytics', async (importOriginal) => {
    loading.started()
    await loading.pending
    return importOriginal()
})

it('waits for analytics acquisition before exposing real autocapture', async () => {
    document.body.innerHTML = '<button>Save</button>'
    let ready = false
    const pending = createPostHog({
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
    }).then((client) => {
        ready = true
        return client
    })
    try {
        const state = await Promise.race([loading.requested.then(() => 'loading'), pending.then(() => 'ready')])
        expect(state).toBe('loading')
        expect(ready).toBe(false)
        loading.release()
        const client = await pending
        expect(client.autocapture).toBeDefined()
        const captured = vi.fn()
        requireInstalledExtension(client.analytics).onEvent(captured)
        document.querySelector('button')!.click()
        expect(captured).toHaveBeenCalledOnce()
        expect(captured).toHaveBeenCalledWith(expect.objectContaining({ event: '$autocapture' }))
    } finally {
        loading.release()
        await (await pending).shutdown(0)
        document.body.innerHTML = ''
    }
})
