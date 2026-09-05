import { mockLogger } from './helpers/mock-logger'

import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { isUndefined } from '@posthog/core'

describe('identify', () => {
    // Note that there are other tests for identify in posthog-core.identify.js
    // These are in the old style of tests, if you are feeling helpful you could
    // convert them to the new style in this file.

    it('should persist the distinct_id', async () => {
        // arrange
        const token = uuidv7()
        const posthog = await createPosthogInstance(token, { before_send: (cr) => cr })
        const distinctId = '123'

        // act
        posthog.identify(distinctId)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctId)
        expect(mockLogger.error).toBeCalledTimes(0)
        expect(mockLogger.warn).toBeCalledTimes(0)
    })

    it('should convert a numeric distinct_id to a string', async () => {
        // arrange
        const token = uuidv7()
        const posthog = await createPosthogInstance(token, { before_send: (cr) => cr })
        const distinctIdNum = 123
        const distinctIdString = '123'

        // act
        posthog.identify(distinctIdNum as any)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctIdString)
        expect(mockLogger.error).toBeCalledTimes(0)
        expect(mockLogger.warn).toBeCalledWith(
            'The first argument to posthog.identify was a number, but it should be a string. It has been converted to a string.'
        )
    })

    describe('invalid distinct_id', () => {
        it.each([
            ['undefined', undefined, 'Unique user id has not been set in posthog.identify'],
            ['null', null, 'Unique user id has not been set in posthog.identify'],
            ['empty string', '', 'Unique user id has not been set in posthog.identify'],
            ['whitespace only', '   ', 'Unique user id has not been set in posthog.identify'],
            ['false', false, 'Unique user id has not been set in posthog.identify'],
            [
                'the string "undefined"',
                'undefined',
                'The string "undefined" was set in posthog.identify which indicates an error. This ID should be unique to the user and not a hardcoded string.',
            ],
            [
                'the string "null"',
                'null',
                'The string "null" was set in posthog.identify which indicates an error. This ID should be unique to the user and not a hardcoded string.',
            ],
        ])('should reject %s and log a critical error', async (_label, invalidId, expectedMessage) => {
            const token = uuidv7()
            const beforeSendMock = vi.fn().mockImplementation((e) => e)
            const posthog = await createPosthogInstance(token, { before_send: beforeSendMock })

            if (isUndefined(invalidId)) {
                // @ts-expect-error A distinct ID is required.
                posthog.identify()
            } else {
                posthog.identify(invalidId as any)
            }

            expect(beforeSendMock).not.toHaveBeenCalled()
            expect(mockLogger.critical).toHaveBeenCalledWith(expectedMessage)
        })
    })

    it('should send $is_identified = true with the identify event and following events', async () => {
        // arrange
        const token = uuidv7()
        const beforeSendMock = vi.fn().mockImplementation((e) => e)
        const posthog = await createPosthogInstance(token, { before_send: beforeSendMock })
        const distinctId = '123'

        // act
        posthog.capture('custom event before identify')
        posthog.identify(distinctId)
        posthog.capture('custom event after identify')

        // assert
        const eventBeforeIdentify = beforeSendMock.mock.calls[0]
        expect(eventBeforeIdentify[0].properties.$is_identified).toEqual(false)
        const identifyCall = beforeSendMock.mock.calls[1]
        expect(identifyCall[0].event).toEqual('$identify')
        expect(identifyCall[0].properties.$is_identified).toEqual(true)
        const eventAfterIdentify = beforeSendMock.mock.calls[2]
        expect(eventAfterIdentify[0].properties.$is_identified).toEqual(true)
    })
})

describe('non-unique distinct_id warning', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        warnSpy.mockRestore()
    })

    it.each([['john'], ['admin'], ['TestUser']])('warns for the human-readable ID %s', async (id) => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        posthog.identify(id)

        expect(warnSpy).toHaveBeenCalledWith(
            '[PostHog.js]',
            expect.stringContaining('The ID passed to identify() looks like a name or a username')
        )
        // the ID is a name or a username by construction, and console output reaches session
        // replays and other console-capturing tools, so it must stay out of the message
        expect(warnSpy).not.toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining(id))
        // the warning must not block the call
        expect(posthog.get_distinct_id()).toEqual(id)
    })

    it('warns once, however many times the app identifies', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        posthog.identify('john')
        posthog.identify('john')
        posthog.identify('jane')

        expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('does not warn when person_profiles is never, because identify() is ignored', async () => {
        const posthog = await createPosthogInstance(uuidv7(), {
            before_send: () => null,
            person_profiles: 'never',
        })

        posthog.identify('john')

        expect(warnSpy).not.toHaveBeenCalled()
    })

    it.each([
        ['a UUID', '018f1f0a-0d5f-7000-8000-000000000000'],
        ['a database ID', '12345'],
        ['an email address', 'jane@example.com'],
        ['a prefixed ID', 'user_1a2b'],
        ['a long opaque token', 'aBcDeFgHiJkLmNoPqR'],
    ])('does not warn for %s', async (_label, id) => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        posthog.identify(id)

        expect(warnSpy).not.toHaveBeenCalled()
    })
})

describe('suppressed person processing warning', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        warnSpy.mockRestore()
    })

    const captureEvents = (posthog: PostHog, count: number, eventName = 'custom event') => {
        for (let i = 0; i < count; i++) {
            posthog.capture(eventName)
        }
    }

    it('warns once after enough events without person processing', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        captureEvents(posthog, 49)
        expect(warnSpy).not.toHaveBeenCalled()

        captureEvents(posthog, 1)
        expect(warnSpy).toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('created no person profile'))

        warnSpy.mockClear()
        captureEvents(posthog, 60)
        expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not warn once the user is identified', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        posthog.identify('018f1f0a-0d5f-7000-8000-000000000000')
        captureEvents(posthog, 100)

        expect(warnSpy).not.toHaveBeenCalled()
    })

    it.each([['never'], ['always']] as const)('does not warn when person_profiles is %s', async (personProfiles) => {
        const posthog = await createPosthogInstance(uuidv7(), {
            before_send: () => null,
            person_profiles: personProfiles,
        })

        captureEvents(posthog, 100)

        expect(warnSpy).not.toHaveBeenCalled()
    })

    it('stops counting once the user is identified, so a reset() at logout cannot warn', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        captureEvents(posthog, 49)
        posthog.identify('018f1f0a-0d5f-7000-8000-000000000000')
        posthog.reset()
        captureEvents(posthog, 100)

        expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not count session recording snapshots', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { before_send: () => null })

        captureEvents(posthog, 100, '$snapshot')

        expect(warnSpy).not.toHaveBeenCalled()
    })
})
