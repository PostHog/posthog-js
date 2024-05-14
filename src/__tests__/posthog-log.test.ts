import _posthog, { PostHogConfig } from '../loader-module'
import { uuidv7 } from '../uuidv7'

describe('posthog log', () => {
    describe('capture()', () => {
        const setup = (config: Partial<PostHogConfig> = {}) => {
            const onCapture = jest.fn()
            const posthog = _posthog.init('testtoken', { ...config, _onCapture: onCapture }, uuidv7())!
            posthog.debug()
            return { posthog, onCapture }
        }

        it('captures manual logs', () => {
            const { posthog, onCapture } = setup()
            posthog.log('test log')
            expect(onCapture.mock.calls[0][0]).toBe('$log')
            expect(onCapture.mock.calls[0][1].properties).toMatchObject({
                message: 'test log',
            })
        })

        it('captures logs properties', () => {
            const { posthog, onCapture } = setup()
            posthog.log('test log', { wat: 'is this value' })
            expect(onCapture.mock.calls[0][0]).toBe('$log')
            expect(onCapture.mock.calls[0][1].properties).toMatchObject({
                message: 'test log',
                wat: 'is this value',
            })
        })
    })
})
