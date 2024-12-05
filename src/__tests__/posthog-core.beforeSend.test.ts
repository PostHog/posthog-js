import { mockLogger } from './helpers/mock-logger'

import { uuidv7 } from '../uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'
import { CaptureResult, knownUnsafeEditableEvent, PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'

const rejectingEventFn = () => {
    return null
}

const editingEventFn = (captureResult: CaptureResult): CaptureResult => {
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
}

describe('posthog core - before send', () => {
    const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))
    const eventName = '$event'

    const posthogWith = (configOverride: Pick<Partial<PostHogConfig>, 'before_send'>): PostHog => {
        const posthog = defaultPostHog().init('testtoken', configOverride, uuidv7())
        return Object.assign(posthog, {
            _send_request: jest.fn(),
        })
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(baseUTCDateTime)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('can reject an event', () => {
        const posthog = posthogWith({
            before_send: rejectingEventFn,
        })
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = posthog.capture(eventName, {}, {})

        expect(capturedData).toBeUndefined()
        expect(posthog._send_request).not.toHaveBeenCalled()
        expect(mockLogger.info).toHaveBeenCalledWith(`Event '${eventName}' was rejected in beforeSend function`)
    })

    it('can edit an event', () => {
        const posthog = posthogWith({
            before_send: editingEventFn,
        })
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

    it('can take an array of fns', () => {
        const posthog = posthogWith({
            before_send: [
                (cr) => {
                    cr.properties = { ...cr.properties, edited_one: true }
                    return cr
                },
                (cr) => {
                    if (cr.event === 'to reject') {
                        return null
                    }
                    return cr
                },
                (cr) => {
                    cr.properties = { ...cr.properties, edited_two: true }
                    return cr
                },
            ],
        })
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = [posthog.capture(eventName, {}, {}), posthog.capture('to reject', {}, {})]

        expect(capturedData.filter((cd) => !!cd)).toHaveLength(1)
        expect(capturedData[0]).toHaveProperty(['properties', 'edited_one'], true)
        expect(capturedData[0]).toHaveProperty(['properties', 'edited_one'], true)
        expect(posthog._send_request).toHaveBeenCalledWith({
            batchKey: undefined,
            callback: expect.any(Function),
            compression: 'best-available',
            data: capturedData[0],
            method: 'POST',
            url: 'https://us.i.posthog.com/e/',
        })
    })

    it('can sanitize $set event', () => {
        const posthog = posthogWith({
            before_send: (cr) => {
                cr.$set = { value: 'edited' }
                return cr
            },
        })
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = posthog.capture('$set', {}, { $set: { value: 'provided' } })

        expect(capturedData).toHaveProperty(['$set', 'value'], 'edited')
        expect(posthog._send_request).toHaveBeenCalledWith({
            batchKey: undefined,
            callback: expect.any(Function),
            compression: 'best-available',
            data: capturedData,
            method: 'POST',
            url: 'https://us.i.posthog.com/e/',
        })
    })

    it('warned when making arbitrary event invalid', () => {
        const posthog = posthogWith({
            before_send: (cr) => {
                cr.properties = undefined
                return cr
            },
        })
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = posthog.capture(eventName, { value: 'provided' }, {})

        expect(capturedData).not.toHaveProperty(['properties', 'value'], 'provided')
        expect(posthog._send_request).toHaveBeenCalledWith({
            batchKey: undefined,
            callback: expect.any(Function),
            compression: 'best-available',
            data: capturedData,
            method: 'POST',
            url: 'https://us.i.posthog.com/e/',
        })
        expect(mockLogger.warn).toHaveBeenCalledWith(
            `Event '${eventName}' has no properties after beforeSend function, this is likely an error.`
        )
    })

    it('logs a warning when rejecting an unsafe to edit event', () => {
        const posthog = posthogWith({
            before_send: rejectingEventFn,
        })
        ;(posthog._send_request as jest.Mock).mockClear()
        // chooses a random string from knownUnEditableEvent
        const randomUnsafeEditableEvent =
            knownUnsafeEditableEvent[Math.floor(Math.random() * knownUnsafeEditableEvent.length)]

        posthog.capture(randomUnsafeEditableEvent, {}, {})

        expect(mockLogger.warn).toHaveBeenCalledWith(
            `Event '${randomUnsafeEditableEvent}' was rejected in beforeSend function. This can cause unexpected behavior.`
        )
    })
})
