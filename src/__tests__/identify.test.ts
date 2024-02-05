import { v4 } from 'uuid'
import { createPosthogInstance } from '../../functional_tests/posthog-instance'
import { logger } from '../utils/logger'
jest.mock('../utils/logger')

describe('identify', () => {
    // Note that there are other tests for identify in posthog-core.identify.js
    // These are in the old style of tests, if you are feeling helpful you could
    // convert them to the new style in this file.

    it('should persist the distinct_id', async () => {
        // arrange
        const token = v4()
        const posthog = await createPosthogInstance(token)
        const distinctId = '123'

        // act
        posthog.identify(distinctId)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctId)
        expect(jest.mocked(logger).error).toBeCalledTimes(0)
    })

    it('should convert a numeric distinct_id to a string', async () => {
        // arrange
        const token = v4()
        const posthog = await createPosthogInstance(token)
        const distinctIdNum = 123
        const distinctIdString = '123'

        // act
        posthog.identify(distinctIdNum as any)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctIdString)
        expect(jest.mocked(logger).error).toBeCalledTimes(1)
    })
})
