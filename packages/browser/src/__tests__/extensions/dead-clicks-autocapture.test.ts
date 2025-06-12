import { PostHog } from '../../posthog-core'
import { assignableWindow } from '../../utils/globals'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '../../uuidv7'
import { DeadClicksAutocapture } from '../../extensions/dead-clicks-autocapture'
import { DEAD_CLICKS_ENABLED_SERVER_SIDE } from '../../constants'

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
        new DeadClicksAutocapture(instance, () => true).startIfEnabled()

        expect(mockLoader).toHaveBeenCalledWith(instance, 'dead-clicks-autocapture', expect.any(Function))
    })

    it('should call lazy loaded stop when stopping', async () => {
        const instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            autocapture: true,
            capture_dead_clicks: true,
        })

        const mockLazyStop = instance.deadClicksAutocapture.lazyLoadedDeadClicksAutocapture?.stop
        instance.deadClicksAutocapture.stop()

        expect(mockLazyStop).toHaveBeenCalled()
        expect(instance.deadClicksAutocapture.lazyLoadedDeadClicksAutocapture).toBeUndefined()
    })

    describe('config', () => {
        let instance: PostHog

        beforeEach(async () => {
            instance = await createPosthogInstance(uuidv7(), {
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: true,
                capture_dead_clicks: true,
            })
        })

        it.each([
            ['enabled when both enabled', true, true, true],
            ['uses client side setting when set to false', true, false, false],
            ['uses client side setting when set to true', false, true, true],
            ['disabled when both disabled', false, false, false],
            ['uses client side setting (disabled) if server side setting is not set', undefined, false, false],
            ['uses client side setting (enabled) if server side setting is not set', undefined, true, true],
            ['is disabled when nothing is set', undefined, undefined, false],
            ['uses server side setting (disabled) if client side setting is not set', undefined, false, false],
            ['uses server side setting (enabled) if client side setting is not set', undefined, true, true],
        ])(
            '%s',
            (_name: string, serverSide: boolean | undefined, clientSide: boolean | undefined, expected: boolean) => {
                instance.persistence?.register({
                    [DEAD_CLICKS_ENABLED_SERVER_SIDE]: serverSide,
                })
                instance.config.capture_dead_clicks = clientSide
                expect(instance.deadClicksAutocapture.isEnabled(instance.deadClicksAutocapture)).toBe(expected)
            }
        )
    })
})
