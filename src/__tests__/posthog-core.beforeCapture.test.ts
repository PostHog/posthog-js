import { uuidv7 } from '../uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'
import { logger } from '../utils/logger'
import { CaptureResult, knownUnEditableEvent, knownUnsafeEditableEvent, PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'

jest.mock('../utils/logger')
jest.mock('../decide')

describe('posthog core - before capture', () => {
    const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))
    const eventName = '$event'

    const defaultConfig = {}

    const defaultOverrides = {
        _send_request: jest.fn(),
    }

    const posthogWith = (config: Partial<PostHogConfig>, overrides?: Partial<PostHog>): PostHog => {
        const posthog = defaultPostHog().init('testtoken', config, uuidv7())
        return Object.assign(posthog, overrides || {})
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(baseUTCDateTime)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('can reject an event', () => {
        const posthog = posthogWith(
            {
                ...defaultConfig,
                beforeCapture: () => {
                    return null
                },
            },
            defaultOverrides
        )
        ;(posthog._send_request as jest.Mock).mockClear()
        const capturedData = posthog.capture(eventName, {}, {})
        expect(capturedData).toBeUndefined()
        expect(posthog._send_request).not.toHaveBeenCalled()
    })

    it('can edit an event', () => {
        const posthog = posthogWith(
            {
                ...defaultConfig,
                beforeCapture: (captureResult: CaptureResult): CaptureResult => {
                    return {
                        ...captureResult,
                        properties: {
                            ...captureResult.properties,
                            edited: true,
                        },
                        $set: {
                            ...captureResult.$set,
                            edited: true,
                        },
                    }
                },
            },
            defaultOverrides
        )
        ;(posthog._send_request as jest.Mock).mockClear()
        const capturedData = posthog.capture(eventName, {}, {})
        expect(capturedData).toHaveProperty(['properties', 'edited'], true)
        expect(capturedData).toHaveProperty(['$set', 'edited'], true)

        expect(posthog._send_request).toHaveBeenCalledWith({
            batchKey: undefined,
            callback: expect.any(Function),
            compression: 'best-available',
            data: capturedData,
            method: 'POST',
            url: 'https://us.i.posthog.com/e/',
        })
    })

    it('cannot reject an un-editable event', () => {
        const posthog = posthogWith(
            {
                ...defaultConfig,
                beforeCapture: () => {
                    return null
                },
            },
            defaultOverrides
        )
        ;(posthog._send_request as jest.Mock).mockClear()
        // chooses a random string from knownUnEditableEvent
        const randomUneditableEvent = knownUnEditableEvent[Math.floor(Math.random() * knownUnEditableEvent.length)]

        const capturedData = posthog.capture(randomUneditableEvent, {}, {})

        expect(capturedData).not.toBeUndefined()
        expect(posthog._send_request).toHaveBeenCalled()
    })

    it('cannot edit an un-editable event', () => {
        const posthog = posthogWith(
            {
                ...defaultConfig,
                beforeCapture: (captureResult: CaptureResult): CaptureResult => {
                    return {
                        ...captureResult,
                        properties: {
                            ...captureResult.properties,
                            edited: true,
                        },
                        $set: {
                            ...captureResult.$set,
                            edited: true,
                        },
                    }
                },
            },
            defaultOverrides
        )
        ;(posthog._send_request as jest.Mock).mockClear()
        // chooses a random string from knownUnEditableEvent
        const randomUneditableEvent = knownUnEditableEvent[Math.floor(Math.random() * knownUnEditableEvent.length)]

        const capturedData = posthog.capture(randomUneditableEvent, {}, {})

        expect(capturedData).not.toHaveProperty(['properties', 'edited'])
        expect(capturedData).not.toHaveProperty(['$set', 'edited'])
        expect(posthog._send_request).toHaveBeenCalled()
    })

    it('logs a warning when rejecting an unsafe to edit event', () => {
        const posthog = posthogWith(
            {
                ...defaultConfig,
                beforeCapture: () => {
                    return null
                },
            },
            defaultOverrides
        )
        ;(posthog._send_request as jest.Mock).mockClear()
        // chooses a random string from knownUnEditableEvent
        const randomUnsafeEditableEvent =
            knownUnsafeEditableEvent[Math.floor(Math.random() * knownUnsafeEditableEvent.length)]

        posthog.capture(randomUnsafeEditableEvent, {}, {})

        expect(jest.mocked(logger).info).toHaveBeenCalledWith(
            `Event '${randomUnsafeEditableEvent}' was rejected. This can cause unexpected behavior.`
        )
    })
})
