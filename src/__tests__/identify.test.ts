import { createPosthogInstance } from './helpers/posthog-instance'
import { logger } from '../utils/logger'
import { uuidv7 } from '../uuidv7'
jest.mock('../utils/logger')

describe('identify', () => {
    // Note that there are other tests for identify in posthog-core.identify.js
    // These are in the old style of tests, if you are feeling helpful you could
    // convert them to the new style in this file.

    it('should persist the distinct_id', async () => {
        // arrange
        const token = uuidv7()
        const posthog = await createPosthogInstance(token)
        const distinctId = '123'

        // act
        posthog.identify(distinctId)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctId)
        expect(jest.mocked(logger).error).toBeCalledTimes(0)
        expect(jest.mocked(logger).warn).toBeCalledTimes(0)
    })

    it('should convert a numeric distinct_id to a string', async () => {
        // arrange
        const token = uuidv7()
        const posthog = await createPosthogInstance(token)
        const distinctIdNum = 123
        const distinctIdString = '123'

        // act
        posthog.identify(distinctIdNum as any)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctIdString)
        expect(jest.mocked(logger).error).toBeCalledTimes(0)
        expect(jest.mocked(logger).warn).toBeCalledTimes(1)
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
