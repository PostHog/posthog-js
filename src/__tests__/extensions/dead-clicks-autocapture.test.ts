import { PostHog } from '../../posthog-core'
import { assignableWindow } from '../../utils/globals'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '../../uuidv7'
import { DeadClicksAutocapture } from '../../extensions/dead-clicks-autocapture'

describe('DeadClicksAutocapture', () => {
    let mockStart: jest.Mock

    beforeEach(() => {
        mockStart = jest.fn()
        assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
        assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture = () => ({
            start: mockStart,
            stop: jest.fn(),
        })
        assignableWindow.__PosthogExtensions__.loadExternalDependency = jest
            .fn()
            .mockImplementation(() => (_ph: PostHog, _name: string, cb: (err?: Error) => void) => {
                cb()
            })
    })

    it('should call initDeadClicksAutocapture if isEnabled is true', async () => {
        await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            autocapture: true,
            capture_dead_clicks: true,
        })

        expect(mockStart).toHaveBeenCalled()
    })

    it('should not call initDeadClicksAutocapture if isEnabled is false', async () => {
        await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            autocapture: true,
            capture_dead_clicks: false,
        })

        expect(mockStart).not.toHaveBeenCalled()
    })

    it('should call loadExternalDependency if script is not already loaded', async () => {
        assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture = undefined

        const mockLoader = assignableWindow.__PosthogExtensions__.loadExternalDependency as jest.Mock
        mockLoader.mockClear()

        const instance = await createPosthogInstance(uuidv7(), { capture_dead_clicks: true })
        new DeadClicksAutocapture(instance).startIfEnabled()

        expect(mockLoader).toHaveBeenCalledWith(instance, 'dead-clicks-autocapture', expect.any(Function))
    })

    it('should call lazy loaded stop when stopping', async () => {
        const instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            autocapture: true,
            capture_dead_clicks: true,
        })

        instance.deadClicksAutocapture.stop()

        expect(instance.deadClicksAutocapture.lazyLoadedDeadClicksAutocapture?.stop).toHaveBeenCalled()
    })
})
