import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { logger } from '../utils/logger'
jest.mock('../utils/logger')

describe('person processing', () => {
    const distinctId = '123'

    beforeEach(() => {
        console.error = jest.fn()
    })

    const setup = async (processPerson: 'always' | 'identified_only' | 'never' | undefined) => {
        const token = uuidv7()
        const onCapture = jest.fn()
        const posthog = await createPosthogInstance(token, {
            _onCapture: onCapture,
            __preview_process_person: processPerson,
        })
        return { token, onCapture, posthog }
    }

    describe('init', () => {
        it("should default to 'always' process_person", async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                __preview_process_person: undefined,
            })

            // assert
            expect(posthog.config.__preview_process_person).toEqual('always')
        })
        it('should read process_person from init config', async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                __preview_process_person: 'never',
            })

            // assert
            expect(posthog.config.__preview_process_person).toEqual('never')
        })
    })

    describe('identify', () => {
        it('should fail if process_person is set to never', async () => {
            // arrange
            const { posthog, onCapture } = await setup('never')

            // act
            posthog.identify(distinctId)

            // assert
            expect(jest.mocked(logger).error).toBeCalledTimes(1)
            expect(jest.mocked(logger).error).toHaveBeenCalledWith(
                'posthog.identify was called, but process_person is set to "never". This call will be ignored.'
            )
            expect(onCapture).toBeCalledTimes(0)
        })

        it('should switch events to $person_process=true if process_person is identified_only', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')
            // assert
            expect(jest.mocked(logger).error).toBeCalledTimes(0)
            const eventBeforeIdentify = onCapture.mock.calls[0]
            expect(eventBeforeIdentify[1].properties.$process_person).toEqual(false)
            const identifyCall = onCapture.mock.calls[1]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].properties.$process_person).toEqual(true)
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].properties.$process_person).toEqual(true)
        })

        it('should not change $person_process if process_person is always', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')
            // assert
            expect(jest.mocked(logger).error).toBeCalledTimes(0)
            const eventBeforeIdentify = onCapture.mock.calls[0]
            expect(eventBeforeIdentify[1].properties.$process_person).toEqual(true)
            const identifyCall = onCapture.mock.calls[1]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].properties.$process_person).toEqual(true)
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].properties.$process_person).toEqual(true)
        })

        it('should include initial referrer info in identify event if identified_only', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = onCapture.mock.calls[0]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].$set_once).toEqual({
                $initial_referrer: '$direct',
                $initial_referring_domain: '$direct',
            })
        })

        it('should not include initial referrer info in identify event if always', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = onCapture.mock.calls[0]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].$set_once).toEqual({})
        })
    })

    describe('capture', () => {
        it('should include initial referrer info iff the event has person processing when in identified_only mode', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')

            // assert
            const eventBeforeIdentify = onCapture.mock.calls[0]
            expect(eventBeforeIdentify[1].$set_once).toBeUndefined()
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].$set_once).toEqual({
                $initial_referrer: '$direct',
                $initial_referring_domain: '$direct',
            })
        })

        it('should not add initial referrer to set_once when in always mode', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')

            // assert
            const eventBeforeIdentify = onCapture.mock.calls[0]
            expect(eventBeforeIdentify[1].$set_once).toEqual(undefined)
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].$set_once).toEqual(undefined)
        })
    })

    describe('group', () => {
        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before group')
            posthog.group('groupType', 'groupKey', { prop: 'value' })
            posthog.capture('custom event after group')

            // assert
            const eventBeforeGroup = onCapture.mock.calls[0]
            expect(eventBeforeGroup[1].properties.$process_person).toEqual(false)
            const groupIdentify = onCapture.mock.calls[1]
            expect(groupIdentify[0]).toEqual('$groupidentify')
            expect(groupIdentify[1].properties.$process_person).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person).toEqual(true)
        })

        it('should not send the $groupidentify event if person_processing is set to never', async () => {
            // arrange
            const { posthog, onCapture } = await setup('never')

            // act
            posthog.capture('custom event before group')
            posthog.group('groupType', 'groupKey', { prop: 'value' })
            posthog.capture('custom event after group')

            // assert
            expect(jest.mocked(logger).error).toBeCalledTimes(1)
            expect(jest.mocked(logger).error).toHaveBeenCalledWith(
                'posthog.group was called, but process_person is set to "never". This call will be ignored.'
            )

            expect(onCapture).toBeCalledTimes(2)
            const eventBeforeGroup = onCapture.mock.calls[0]
            expect(eventBeforeGroup[1].properties.$process_person).toEqual(false)
            const eventAfterGroup = onCapture.mock.calls[1]
            expect(eventAfterGroup[1].properties.$process_person).toEqual(false)
        })
    })

    describe('setPersonProperties', () => {
        it("should not send a $set event if process_person is set to 'never'", async () => {
            // arrange
            const { posthog, onCapture } = await setup('never')

            // act
            posthog.setPersonProperties({ prop: 'value' })

            // assert
            expect(onCapture).toBeCalledTimes(0)
            expect(jest.mocked(logger).error).toBeCalledTimes(1)
            expect(jest.mocked(logger).error).toHaveBeenCalledWith(
                'posthog.setPersonProperties was called, but process_person is set to "never". This call will be ignored.'
            )
        })

        it("should send a $set event if process_person is set to 'always'", async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.setPersonProperties({ prop: 'value' })

            // assert
            expect(onCapture).toBeCalledTimes(1)
            expect(onCapture.mock.calls[0][0]).toEqual('$set')
        })

        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before setPersonProperties')
            posthog.setPersonProperties({ prop: 'value' })
            posthog.capture('custom event after setPersonProperties')

            // assert
            const eventBeforeGroup = onCapture.mock.calls[0]
            expect(eventBeforeGroup[1].properties.$process_person).toEqual(false)
            const set = onCapture.mock.calls[1]
            expect(set[0]).toEqual('$set')
            expect(set[1].properties.$process_person).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person).toEqual(true)
        })
    })

    describe('alias', () => {
        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before alias')
            posthog.alias('alias')
            posthog.capture('custom event after alias')

            // assert
            const eventBeforeGroup = onCapture.mock.calls[0]
            expect(eventBeforeGroup[1].properties.$process_person).toEqual(false)
            const alias = onCapture.mock.calls[1]
            expect(alias[0]).toEqual('$create_alias')
            expect(alias[1].properties.$process_person).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person).toEqual(true)
        })

        it('should not send a $create_alias event if person processing is set to "never"', async () => {
            // arrange
            const { posthog, onCapture } = await setup('never')

            // act
            posthog.alias('alias')

            // assert
            expect(onCapture).toBeCalledTimes(0)
            expect(jest.mocked(logger).error).toBeCalledTimes(1)
            expect(jest.mocked(logger).error).toHaveBeenCalledWith(
                'posthog.alias was called, but process_person is set to "never". This call will be ignored.'
            )
        })
    })
})
