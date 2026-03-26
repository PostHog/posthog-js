import { mockLogger } from './helpers/mock-logger'

import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'

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
            const beforeSendMock = jest.fn().mockImplementation((e) => e)
            const posthog = await createPosthogInstance(token, { before_send: beforeSendMock })

            posthog.identify(invalidId as any)

            expect(beforeSendMock).not.toHaveBeenCalled()
            expect(mockLogger.critical).toHaveBeenCalledWith(expectedMessage)
        })
    })

    it('should send $is_identified = true with the identify event and following events', async () => {
        // arrange
        const token = uuidv7()
        const beforeSendMock = jest.fn().mockImplementation((e) => e)
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
