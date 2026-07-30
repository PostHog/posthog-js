import { createTestClient } from './helpers/test-client'

describe('TestClient remote config', () => {
    it('replays the latest outcome and publishes subsequent outcomes', () => {
        const client = createTestClient()
        const firstListener = jest.fn()
        client.onRemoteConfig(firstListener)

        expect(firstListener).not.toHaveBeenCalled()

        const failure = { ok: false } as const
        client.setRemoteConfigResult(failure)
        expect(firstListener).toHaveBeenLastCalledWith(failure)

        const lateListener = jest.fn()
        client.onRemoteConfig(lateListener)
        expect(lateListener).toHaveBeenCalledWith(failure)

        const success = { ok: true, config: { supportedCompression: [] } } as const
        client.setRemoteConfigResult(success)
        expect(firstListener).toHaveBeenLastCalledWith(success)
        expect(lateListener).toHaveBeenLastCalledWith(success)
    })

    it('does not swallow listener errors', () => {
        const client = createTestClient()
        const error = new Error('listener failed')
        client.onRemoteConfig(() => {
            throw error
        })

        expect(() => client.setRemoteConfigResult({ ok: false })).toThrow(error)
    })
})
