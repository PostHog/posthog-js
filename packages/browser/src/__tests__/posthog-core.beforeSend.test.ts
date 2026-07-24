import { mockLogger } from './helpers/mock-logger'

import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'
import { CaptureResult, PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'
import { knownUnsafeEditableEvent, UUID_REGEX } from '@posthog/core'

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

const invalidUuidCases = [
    ['arbitrary string', 'not-a-uuid'],
    ['empty string', ''],
    ['32-character hex string', '0189dcd553117d408db09496a2eef37b'],
    ['braced UUID', '{0189dcd5-5311-7d40-8db0-9496a2eef37b}'],
    ['URN UUID', 'urn:uuid:0189dcd5-5311-7d40-8db0-9496a2eef37b'],
] as const

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
            timestampMode: 'capture-body',
            url: 'https://us.i.posthog.com/e/',
        })
    })

    it('uses a valid provided uuid', () => {
        const posthog = posthogWith({})
        ;(posthog._send_request as jest.Mock).mockClear()
        const uuid = uuidv7()

        const capturedData = posthog.capture(eventName, {}, { uuid })

        expect(capturedData).toHaveProperty('uuid', uuid)
    })

    it.each(invalidUuidCases)('generates a new uuid when the provided uuid is an invalid %s', (_, invalidUuid) => {
        const posthog = posthogWith({})
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = posthog.capture(eventName, {}, { uuid: invalidUuid })

        expect(capturedData).toHaveProperty('uuid', expect.stringMatching(UUID_REGEX))
        expect(capturedData?.uuid).not.toBe(invalidUuid)
    })

    it.each(invalidUuidCases)('generates a new uuid when before_send returns an invalid %s', (_, invalidUuid) => {
        const posthog = posthogWith({
            before_send: (cr) => cr && { ...cr, uuid: invalidUuid },
        })
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = posthog.capture(eventName, {}, {})

        expect(capturedData).toHaveProperty('uuid', expect.stringMatching(UUID_REGEX))
        expect(capturedData?.uuid).not.toBe(invalidUuid)
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
            timestampMode: 'capture-body',
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
            timestampMode: 'capture-body',
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
            timestampMode: 'capture-body',
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

    it('drops the event if a beforeSend function strips a required property like token', () => {
        // Regression test for #3438: the project api_key is sent on
        // properties.token, so a generic token/PII scrubber that drops it would
        // otherwise make every event 401 with "submitted without an api_key".
        // We drop the event and warn rather than send something ingest will reject.
        const posthog = posthogWith({
            before_send: (cr) => {
                if (cr.properties) {
                    for (const key of Object.keys(cr.properties)) {
                        if (/token/i.test(key)) {
                            delete cr.properties[key]
                        }
                    }
                }
                return cr
            },
        })
        ;(posthog._send_request as jest.Mock).mockClear()

        const capturedData = posthog.capture(eventName, {}, {})

        expect(capturedData).toBeUndefined()
        expect(posthog._send_request).not.toHaveBeenCalled()
        expect(mockLogger.warn).toHaveBeenCalledWith(
            `Event '${eventName}' had its 'token' property removed in a beforeSend function. This property is required for ingestion, so the event will be dropped.`
        )
    })
})
