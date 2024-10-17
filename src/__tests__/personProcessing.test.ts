import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { logger } from '../utils/logger'
import { INITIAL_CAMPAIGN_PARAMS, INITIAL_REFERRER_INFO } from '../constants'

jest.mock('../utils/logger')

const INITIAL_CAMPAIGN_PARAMS_NULL = {
    $initial_current_url: null,
    $initial_dclid: null,
    $initial_fbclid: null,
    $initial_gad_source: null,
    $initial_gbraid: null,
    $initial_gclid: null,
    $initial_gclsrc: null,
    $initial_host: null,
    $initial_igshid: null,
    $initial_li_fat_id: null,
    $initial_mc_cid: null,
    $initial_msclkid: null,
    $initial_pathname: null,
    $initial_rdt_cid: null,
    $initial_referrer: null,
    $initial_referring_domain: null,
    $initial_ttclid: null,
    $initial_twclid: null,
    $initial_utm_campaign: null,
    $initial_utm_content: null,
    $initial_utm_medium: null,
    $initial_utm_source: null,
    $initial_utm_term: null,
    $initial_wbraid: null,
}

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            get referrer() {
                return mockReferrerGetter()
            },
            get URL() {
                return mockURLGetter()
            },
        },
        get location() {
            const url = mockURLGetter()
            return {
                href: url,
                toString: () => url,
            }
        },
    }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockURLGetter, mockReferrerGetter } = require('../utils/globals')

describe('person processing', () => {
    const distinctId = '123'
    beforeEach(() => {
        console.error = jest.fn()
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com?utm_source=foo')
    })

    const setup = async (person_profiles: 'always' | 'identified_only' | 'never' | undefined, token?: string) => {
        token = token || uuidv7()
        const onCapture = jest.fn()
        const posthog = await createPosthogInstance(token, {
            _onCapture: onCapture,
            person_profiles,
        })
        return { token, onCapture, posthog }
    }

    describe('init', () => {
        it("should default to 'always' person_profiles", async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                person_profiles: undefined,
            })

            // assert
            expect(posthog.config.person_profiles).toEqual('always')
        })
        it('should read person_profiles from init config', async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                person_profiles: 'never',
            })

            // assert
            expect(posthog.config.person_profiles).toEqual('never')
        })
        it('should read person_profiles from init config as process_person', async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                process_person: 'never',
            })

            // assert
            expect(posthog.config.person_profiles).toEqual('never')
        })
        it('should prefer the correct name to the deprecated one', async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                process_person: 'never',
                person_profiles: 'identified_only',
            })

            // assert
            expect(posthog.config.person_profiles).toEqual('identified_only')
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
            expect(eventBeforeIdentify[1].properties.$process_person_profile).toEqual(false)
            const identifyCall = onCapture.mock.calls[1]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].properties.$process_person_profile).toEqual(true)
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].properties.$process_person_profile).toEqual(true)
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
            expect(eventBeforeIdentify[1].properties.$process_person_profile).toEqual(true)
            const identifyCall = onCapture.mock.calls[1]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].properties.$process_person_profile).toEqual(true)
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].properties.$process_person_profile).toEqual(true)
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
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
            })
        })

        it('should preserve initial referrer info across a separate session', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')
            mockReferrerGetter.mockReturnValue('https://referrer1.com')
            mockURLGetter.mockReturnValue('https://example1.com/pathname1?utm_source=foo1')

            // act
            // s1
            posthog.capture('event s1')

            // end session
            posthog.sessionManager!.resetSessionId()
            posthog.sessionPersistence!.clear()

            // s2
            mockReferrerGetter.mockReturnValue('https://referrer2.com')
            mockURLGetter.mockReturnValue('https://example2.com/pathname2?utm_source=foo2')
            posthog.capture('event s2 before identify')
            posthog.identify(distinctId)
            posthog.capture('event s2 after identify')

            // assert
            const eventS1 = onCapture.mock.calls[0]
            const eventS2Before = onCapture.mock.calls[1]
            const eventS2Identify = onCapture.mock.calls[2]
            const eventS2After = onCapture.mock.calls[3]

            expect(eventS1[1].$set_once).toEqual(undefined)

            expect(eventS2Before[1].$set_once).toEqual(undefined)

            expect(eventS2Identify[0]).toEqual('$identify')
            expect(eventS2Identify[1].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example1.com/pathname1?utm_source=foo1',
                $initial_host: 'example1.com',
                $initial_pathname: '/pathname1',
                $initial_referrer: 'https://referrer1.com',
                $initial_referring_domain: 'referrer1.com',
                $initial_utm_source: 'foo1',
            })

            expect(eventS2After[0]).toEqual('event s2 after identify')
            expect(eventS2After[1].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example1.com/pathname1?utm_source=foo1',
                $initial_host: 'example1.com',
                $initial_pathname: '/pathname1',
                $initial_referrer: 'https://referrer1.com',
                $initial_referring_domain: 'referrer1.com',
                $initial_utm_source: 'foo1',
            })
        })

        it('should include initial referrer info in identify event if always', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = onCapture.mock.calls[0]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
            })
        })

        it('should include initial search params', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')
            mockReferrerGetter.mockReturnValue('https://www.google.com?q=bar')

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = onCapture.mock.calls[0]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://www.google.com?q=bar',
                $initial_referring_domain: 'www.google.com',
                $initial_utm_source: 'foo',
                $initial_ph_keyword: 'bar',
                $initial_search_engine: 'google',
            })
        })

        it('should be backwards compatible with deprecated INITIAL_REFERRER_INFO and INITIAL_CAMPAIGN_PARAMS way of saving initial person props', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')
            posthog.persistence!.props[INITIAL_REFERRER_INFO] = {
                referrer: 'https://deprecated-referrer.com',
                referring_domain: 'deprecated-referrer.com',
            }
            posthog.persistence!.props[INITIAL_CAMPAIGN_PARAMS] = {
                utm_source: 'deprecated-source',
            }

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = onCapture.mock.calls[0]
            expect(identifyCall[0]).toEqual('$identify')
            expect(identifyCall[1].$set_once).toEqual({
                $initial_referrer: 'https://deprecated-referrer.com',
                $initial_referring_domain: 'deprecated-referrer.com',
                $initial_utm_source: 'deprecated-source',
            })
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
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
            })
        })

        it('should add initial referrer to set_once when in always mode', async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')

            // assert
            const eventBeforeIdentify = onCapture.mock.calls[0]
            expect(eventBeforeIdentify[1].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
            })
            const eventAfterIdentify = onCapture.mock.calls[2]
            expect(eventAfterIdentify[1].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
            })
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
            expect(eventBeforeGroup[1].properties.$process_person_profile).toEqual(false)
            const groupIdentify = onCapture.mock.calls[1]
            expect(groupIdentify[0]).toEqual('$groupidentify')
            expect(groupIdentify[1].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person_profile).toEqual(true)
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
            expect(eventBeforeGroup[1].properties.$process_person_profile).toEqual(false)
            const eventAfterGroup = onCapture.mock.calls[1]
            expect(eventAfterGroup[1].properties.$process_person_profile).toEqual(false)
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
            expect(eventBeforeGroup[1].properties.$process_person_profile).toEqual(false)
            const set = onCapture.mock.calls[1]
            expect(set[0]).toEqual('$set')
            expect(set[1].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person_profile).toEqual(true)
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
            expect(eventBeforeGroup[1].properties.$process_person_profile).toEqual(false)
            const alias = onCapture.mock.calls[1]
            expect(alias[0]).toEqual('$create_alias')
            expect(alias[1].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person_profile).toEqual(true)
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

    describe('createPersonProfile', () => {
        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before createPersonProfile')
            posthog.createPersonProfile()
            posthog.capture('custom event after createPersonProfile')

            // assert
            expect(onCapture.mock.calls.length).toEqual(3)
            const eventBeforeGroup = onCapture.mock.calls[0]
            expect(eventBeforeGroup[1].properties.$process_person_profile).toEqual(false)
            const set = onCapture.mock.calls[1]
            expect(set[0]).toEqual('$set')
            expect(set[1].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = onCapture.mock.calls[2]
            expect(eventAfterGroup[1].properties.$process_person_profile).toEqual(true)
        })

        it('should do nothing if already has person profiles', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')

            // act
            posthog.capture('custom event before createPersonProfile')
            posthog.createPersonProfile()
            posthog.capture('custom event after createPersonProfile')
            posthog.createPersonProfile()

            // assert
            expect(onCapture.mock.calls.length).toEqual(3)
        })

        it("should not send an event if process_person is to set to 'always'", async () => {
            // arrange
            const { posthog, onCapture } = await setup('always')

            // act
            posthog.createPersonProfile()

            // assert
            expect(onCapture).toBeCalledTimes(0)
            expect(jest.mocked(logger).error).toBeCalledTimes(0)
        })
    })

    describe('reset', () => {
        it('should revert a back to anonymous state in identified_only', async () => {
            // arrange
            const { posthog, onCapture } = await setup('identified_only')
            posthog.identify(distinctId)
            posthog.capture('custom event before reset')

            // act
            posthog.reset()
            posthog.capture('custom event after reset')

            // assert
            expect(posthog._isIdentified()).toBe(false)
            expect(onCapture.mock.calls.length).toEqual(3)
            expect(onCapture.mock.calls[2][1].properties.$process_person_profile).toEqual(false)
        })
    })
})
