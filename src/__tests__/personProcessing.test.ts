import { mockLogger } from './helpers/mock-logger'

import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { INITIAL_CAMPAIGN_PARAMS, INITIAL_REFERRER_INFO } from '../constants'
import { RemoteConfig } from '../types'

const INITIAL_CAMPAIGN_PARAMS_NULL = {
    $initial_current_url: null,
    $initial__kx: null,
    $initial_dclid: null,
    $initial_epik: null,
    $initial_fbclid: null,
    $initial_gad_source: null,
    $initial_gbraid: null,
    $initial_gclid: null,
    $initial_gclsrc: null,
    $initial_host: null,
    $initial_igshid: null,
    $initial_irclid: null,
    $initial_li_fat_id: null,
    $initial_mc_cid: null,
    $initial_msclkid: null,
    $initial_pathname: null,
    $initial_qclid: null,
    $initial_rdt_cid: null,
    $initial_referrer: null,
    $initial_referring_domain: null,
    $initial_sccid: null,
    $initial_ttclid: null,
    $initial_twclid: null,
    $initial_utm_campaign: null,
    $initial_utm_content: null,
    $initial_utm_medium: null,
    $initial_utm_source: null,
    $initial_utm_term: null,
    $initial_wbraid: null,
}

const CAMPAIGN_PARAMS_NULL = {
    _kx: null,
    dclid: null,
    epik: null,
    fbclid: null,
    gad_source: null,
    gbraid: null,
    gclid: null,
    gclsrc: null,
    $host: null,
    igshid: null,
    irclid: null,
    li_fat_id: null,
    mc_cid: null,
    msclkid: null,
    qclid: null,
    rdt_cid: null,
    sccid: null,
    ttclid: null,
    twclid: null,
    utm_campaign: null,
    utm_content: null,
    utm_medium: null,
    utm_source: null,
    utm_term: null,
    wbraid: null,
}

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    let mockedCookieVal = ''
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            body: {},
            get referrer() {
                return mockReferrerGetter()
            },
            get URL() {
                return mockURLGetter()
            },
            get cookie() {
                return mockedCookieVal
            },
            set cookie(value: string) {
                mockedCookieVal = value
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
const { mockURLGetter, mockReferrerGetter, document } = require('../utils/globals')

describe('person processing', () => {
    const distinctId = '123'
    beforeEach(() => {
        console.error = jest.fn()
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com?utm_source=foo')
        document.cookie = ''
    })

    const setup = async (
        person_profiles: 'always' | 'identified_only' | 'never' | undefined,
        token?: string,
        persistence_name?: string
    ) => {
        token = token || uuidv7()
        const beforeSendMock = jest.fn().mockImplementation((e) => e)
        const posthog = await createPosthogInstance(token, {
            before_send: beforeSendMock,
            person_profiles,
            persistence_name,
        })
        return { token, beforeSendMock, posthog }
    }

    describe('init', () => {
        it("should default to 'identified_only' person_profiles", async () => {
            // arrange
            const token = uuidv7()

            // act
            const posthog = await createPosthogInstance(token, {
                person_profiles: undefined,
            })

            // assert
            expect(posthog.config.person_profiles).toEqual('identified_only')
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
            const { posthog, beforeSendMock } = await setup('never')

            // act
            posthog.identify(distinctId)

            // assert
            expect(mockLogger.error).toBeCalledTimes(1)
            expect(mockLogger.error).toHaveBeenCalledWith(
                'posthog.identify was called, but process_person is set to "never". This call will be ignored.'
            )
            expect(beforeSendMock).toBeCalledTimes(0)
        })

        it('should switch events to $person_process=true if process_person is identified_only', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')
            // assert
            expect(mockLogger.error).toBeCalledTimes(0)
            const eventBeforeIdentify = beforeSendMock.mock.calls[0]
            expect(eventBeforeIdentify[0].properties.$process_person_profile).toEqual(false)
            const identifyCall = beforeSendMock.mock.calls[1]
            expect(identifyCall[0].event).toEqual('$identify')
            expect(identifyCall[0].properties.$process_person_profile).toEqual(true)
            const eventAfterIdentify = beforeSendMock.mock.calls[2]
            expect(eventAfterIdentify[0].properties.$process_person_profile).toEqual(true)
        })

        it('should not change $person_process if process_person is always', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('always')

            // act
            posthog.capture('custom event before identify')
            posthog.identify(distinctId)
            posthog.capture('custom event after identify')
            // assert
            expect(mockLogger.error).toBeCalledTimes(0)
            const eventBeforeIdentify = beforeSendMock.mock.calls[0]
            expect(eventBeforeIdentify[0].properties.$process_person_profile).toEqual(true)
            const identifyCall = beforeSendMock.mock.calls[1]
            expect(identifyCall[0].event).toEqual('$identify')
            expect(identifyCall[0].properties.$process_person_profile).toEqual(true)
            const eventAfterIdentify = beforeSendMock.mock.calls[2]
            expect(eventAfterIdentify[0].properties.$process_person_profile).toEqual(true)
        })

        it('should include initial referrer info in identify event if identified_only', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = beforeSendMock.mock.calls[0]
            expect(identifyCall[0].event).toEqual('$identify')
            expect(identifyCall[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
                $current_url: 'https://example.com?utm_source=foo',
                $host: 'example.com',
                $pathname: '/',
                $referrer: 'https://referrer.com',
                $referring_domain: 'referrer.com',
                utm_source: 'foo',
            })
        })

        it('should preserve initial referrer info across a separate session', async () => {
            // arrange
            mockReferrerGetter.mockReturnValue('https://referrer1.com')
            mockURLGetter.mockReturnValue('https://example1.com/pathname1?utm_source=foo1')
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            // s1
            posthog.capture('event s1')

            // end session
            posthog.sessionManager!.resetSessionId()
            posthog.sessionPersistence!.clear()
            window.sessionStorage.clear()

            // s2
            mockReferrerGetter.mockReturnValue('https://referrer2.com')
            mockURLGetter.mockReturnValue('https://example2.com/pathname2?utm_source=foo2')
            posthog.capture('event s2 before identify')
            posthog.identify(distinctId)
            posthog.capture('event s2 after identify')

            // assert
            const eventS1 = beforeSendMock.mock.calls[0]
            const eventS2Before = beforeSendMock.mock.calls[1]
            const eventS2Identify = beforeSendMock.mock.calls[2]
            const eventS2After = beforeSendMock.mock.calls[3]

            expect(eventS1[0].$set_once).toEqual(undefined)

            expect(eventS2Before[0].$set_once).toEqual(undefined)

            expect(eventS2Identify[0].event).toEqual('$identify')
            expect(eventS2Identify[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example1.com/pathname1?utm_source=foo1',
                $initial_host: 'example1.com',
                $initial_pathname: '/pathname1',
                $initial_referrer: 'https://referrer1.com',
                $initial_referring_domain: 'referrer1.com',
                $initial_utm_source: 'foo1',
                $current_url: 'https://example2.com/pathname2?utm_source=foo2',
                $host: 'example2.com',
                $pathname: '/pathname2',
                $referrer: 'https://referrer2.com',
                $referring_domain: 'referrer2.com',
                utm_source: 'foo2',
            })

            expect(eventS2After[0].event).toEqual('event s2 after identify')
            expect(eventS2After[0].$set_once).toEqual(undefined)
        })

        it('should preserve initial referrer info across subdomain', async () => {
            const persistenceName = uuidv7()

            mockReferrerGetter.mockReturnValue('https://referrer1.com')
            mockURLGetter.mockReturnValue('https://example1.com/pathname1?utm_source=foo1')
            // arrange
            const { posthog: posthog1, beforeSendMock: beforeSendMock1 } = await setup(
                'identified_only',
                undefined,
                persistenceName
            )

            // act
            // subdomain 1
            posthog1.register({ testProp: 'foo' })
            posthog1.capture('event s1')

            // clear localstorage, but not cookies, to simulate changing subdomain
            window.localStorage.clear()
            window.sessionStorage.clear()

            // subdomain 2
            mockReferrerGetter.mockReturnValue('https://referrer2.com')
            mockURLGetter.mockReturnValue('https://example2.com/pathname2?utm_source=foo2')
            const { posthog: posthog2, beforeSendMock: beforeSendMock2 } = await setup(
                'identified_only',
                undefined,
                persistenceName
            )

            posthog2.capture('event s2 before identify')
            posthog2.identify(distinctId)
            posthog2.capture('event s2 after identify')

            // assert
            const eventS1 = beforeSendMock1.mock.calls[0]
            const eventS2Before = beforeSendMock2.mock.calls[0]
            const eventS2Identify = beforeSendMock2.mock.calls[1]
            const eventS2After = beforeSendMock2.mock.calls[2]

            expect(eventS1[0].$set_once).toEqual(undefined)
            expect(eventS1[0].properties.testProp).toEqual('foo')

            expect(eventS2Before[0].$set_once).toEqual(undefined)
            // most properties are lost across subdomain, that's intentional as we don't want to save too many things in cookies
            expect(eventS2Before[0].properties.testProp).toEqual(undefined)

            expect(eventS2Identify[0].event).toEqual('$identify')
            expect(eventS2Identify[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example1.com/pathname1?utm_source=foo1',
                $initial_host: 'example1.com',
                $initial_pathname: '/pathname1',
                $initial_referrer: 'https://referrer1.com',
                $initial_referring_domain: 'referrer1.com',
                $initial_utm_source: 'foo1',
                $current_url: 'https://example2.com/pathname2?utm_source=foo2',
                $host: 'example2.com',
                $pathname: '/pathname2',
                $referrer: 'https://referrer2.com',
                $referring_domain: 'referrer2.com',
                utm_source: 'foo2',
            })

            expect(eventS2After[0].event).toEqual('event s2 after identify')
            expect(eventS2After[0].$set_once).toEqual(undefined)
        })

        it('should include initial referrer info in identify event if always', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('always')

            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = beforeSendMock.mock.calls[0]
            expect(identifyCall[0].event).toEqual('$identify')
            expect(identifyCall[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
                $current_url: 'https://example.com?utm_source=foo',
                $host: 'example.com',
                $pathname: '/',
                $referrer: 'https://referrer.com',
                $referring_domain: 'referrer.com',
                utm_source: 'foo',
            })
        })

        it('should include initial search params', async () => {
            // arrange
            mockReferrerGetter.mockReturnValue('https://www.google.com?q=bar')
            const { posthog, beforeSendMock } = await setup('always')
            // act
            posthog.identify(distinctId)

            // assert
            const identifyCall = beforeSendMock.mock.calls[0]
            expect(identifyCall[0].event).toEqual('$identify')
            expect(identifyCall[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://www.google.com?q=bar',
                $initial_referring_domain: 'www.google.com',
                $initial_utm_source: 'foo',
                $initial_ph_keyword: 'bar',
                $initial_search_engine: 'google',
                $current_url: 'https://example.com?utm_source=foo',
                $host: 'example.com',
                $pathname: '/',
                $referrer: 'https://www.google.com?q=bar',
                $referring_domain: 'www.google.com',
                utm_source: 'foo',
                ph_keyword: 'bar',
                $search_engine: 'google',
            })
        })

        it('should be backwards compatible with deprecated INITIAL_REFERRER_INFO and INITIAL_CAMPAIGN_PARAMS way of saving initial person props', async () => {
            // arrange
            mockReferrerGetter.mockReturnValue('https://mocked.referrer.com')
            mockURLGetter.mockReturnValue('https://mocked.example.com/mocked-path?utm_source=mocked-source')
            const { posthog, beforeSendMock } = await setup('always')
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
            const identifyCall = beforeSendMock.mock.calls[0]
            expect(identifyCall[0].event).toEqual('$identify')
            expect(identifyCall[0].$set_once).toEqual({
                ...CAMPAIGN_PARAMS_NULL,
                $initial_referrer: 'https://deprecated-referrer.com',
                $initial_referring_domain: 'deprecated-referrer.com',
                $initial_utm_source: 'deprecated-source',
                $host: 'mocked.example.com',
                $pathname: '/mocked-path',
                $referrer: 'https://mocked.referrer.com',
                $referring_domain: 'mocked.referrer.com',
                $current_url: 'https://mocked.example.com/mocked-path?utm_source=mocked-source',
                utm_source: 'mocked-source',
            })
        })
    })

    describe('capture', () => {
        it('should include initial referrer info iff the event has person processing when in identified_only mode', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before identify')
            posthog._requirePersonProcessing('test')
            posthog.capture('custom event after identify')

            // assert
            const eventBeforeIdentify = beforeSendMock.mock.calls[0]
            expect(eventBeforeIdentify[0].$set_once).toBeUndefined()
            const eventAfterIdentify = beforeSendMock.mock.calls[1]
            expect(eventAfterIdentify[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
                $current_url: 'https://example.com?utm_source=foo',
                $host: 'example.com',
                $pathname: '/',
                $referrer: 'https://referrer.com',
                $referring_domain: 'referrer.com',
                utm_source: 'foo',
            })
        })

        it('should add initial referrer to set_once when in always mode', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('always')

            // act
            posthog.capture('custom event before identify')
            posthog._requirePersonProcessing('test')
            posthog.capture('custom event after identify')

            // assert
            const eventBeforeIdentify = beforeSendMock.mock.calls[0]
            expect(eventBeforeIdentify[0].$set_once).toEqual({
                ...INITIAL_CAMPAIGN_PARAMS_NULL,
                ...CAMPAIGN_PARAMS_NULL,
                $initial_current_url: 'https://example.com?utm_source=foo',
                $initial_host: 'example.com',
                $initial_pathname: '/',
                $initial_referrer: 'https://referrer.com',
                $initial_referring_domain: 'referrer.com',
                $initial_utm_source: 'foo',
                $current_url: 'https://example.com?utm_source=foo',
                $host: 'example.com',
                $pathname: '/',
                $referrer: 'https://referrer.com',
                $referring_domain: 'referrer.com',
                utm_source: 'foo',
            })
            const eventAfterIdentify = beforeSendMock.mock.calls[1]
            expect(eventAfterIdentify[0].$set_once).toEqual(undefined)
        })
    })

    describe('group', () => {
        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before group')
            posthog.group('groupType', 'groupKey', { prop: 'value' })
            posthog.capture('custom event after group')

            // assert
            const eventBeforeGroup = beforeSendMock.mock.calls[0]
            expect(eventBeforeGroup[0].properties.$process_person_profile).toEqual(false)
            const groupIdentify = beforeSendMock.mock.calls[1]
            expect(groupIdentify[0].event).toEqual('$groupidentify')
            expect(groupIdentify[0].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = beforeSendMock.mock.calls[2]
            expect(eventAfterGroup[0].properties.$process_person_profile).toEqual(true)
        })

        it('should not send the $groupidentify event if person_processing is set to never', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('never')

            // act
            posthog.capture('custom event before group')
            posthog.group('groupType', 'groupKey', { prop: 'value' })
            posthog.capture('custom event after group')

            // assert
            expect(mockLogger.error).toBeCalledTimes(1)
            expect(mockLogger.error).toHaveBeenCalledWith(
                'posthog.group was called, but process_person is set to "never". This call will be ignored.'
            )

            expect(beforeSendMock).toBeCalledTimes(2)
            const eventBeforeGroup = beforeSendMock.mock.calls[0]
            expect(eventBeforeGroup[0].properties.$process_person_profile).toEqual(false)
            const eventAfterGroup = beforeSendMock.mock.calls[1]
            expect(eventAfterGroup[0].properties.$process_person_profile).toEqual(false)
        })
    })

    describe('setPersonProperties', () => {
        it("should not send a $set event if process_person is set to 'never'", async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('never')

            // act
            posthog.setPersonProperties({ prop: 'value' })

            // assert
            expect(beforeSendMock).toBeCalledTimes(0)
            expect(mockLogger.error).toBeCalledTimes(1)
            expect(mockLogger.error).toHaveBeenCalledWith(
                'posthog.setPersonProperties was called, but process_person is set to "never". This call will be ignored.'
            )
        })

        it("should send a $set event if process_person is set to 'always'", async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('always')

            // act
            posthog.setPersonProperties({ prop: 'value' })

            // assert
            expect(beforeSendMock).toBeCalledTimes(1)
            expect(beforeSendMock.mock.calls[0][0].event).toEqual('$set')
        })

        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before setPersonProperties')
            posthog.setPersonProperties({ prop: 'value' })
            posthog.capture('custom event after setPersonProperties')

            // assert
            const eventBeforeGroup = beforeSendMock.mock.calls[0]
            expect(eventBeforeGroup[0].properties.$process_person_profile).toEqual(false)
            const set = beforeSendMock.mock.calls[1]
            expect(set[0].event).toEqual('$set')
            expect(set[0].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = beforeSendMock.mock.calls[2]
            expect(eventAfterGroup[0].properties.$process_person_profile).toEqual(true)
        })
    })

    describe('alias', () => {
        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before alias')
            posthog.alias('alias')
            posthog.capture('custom event after alias')

            // assert
            const eventBeforeGroup = beforeSendMock.mock.calls[0]
            expect(eventBeforeGroup[0].properties.$process_person_profile).toEqual(false)
            const alias = beforeSendMock.mock.calls[1]
            expect(alias[0].event).toEqual('$create_alias')
            expect(alias[0].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = beforeSendMock.mock.calls[2]
            expect(eventAfterGroup[0].properties.$process_person_profile).toEqual(true)
        })

        it('should not send a $create_alias event if person processing is set to "never"', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('never')

            // act
            posthog.alias('alias')

            // assert
            expect(beforeSendMock).toBeCalledTimes(0)
            expect(mockLogger.error).toBeCalledTimes(1)
            expect(mockLogger.error).toHaveBeenCalledWith(
                'posthog.alias was called, but process_person is set to "never". This call will be ignored.'
            )
        })
    })

    describe('createPersonProfile', () => {
        it('should start person processing for identified_only users', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before createPersonProfile')
            posthog.createPersonProfile()
            posthog.capture('custom event after createPersonProfile')

            // assert
            expect(beforeSendMock.mock.calls.length).toEqual(3)
            const eventBeforeGroup = beforeSendMock.mock.calls[0]
            expect(eventBeforeGroup[0].properties.$process_person_profile).toEqual(false)
            const set = beforeSendMock.mock.calls[1]
            expect(set[0].event).toEqual('$set')
            expect(set[0].properties.$process_person_profile).toEqual(true)
            const eventAfterGroup = beforeSendMock.mock.calls[2]
            expect(eventAfterGroup[0].properties.$process_person_profile).toEqual(true)
        })

        it('should do nothing if already has person profiles', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')

            // act
            posthog.capture('custom event before createPersonProfile')
            posthog.createPersonProfile()
            posthog.capture('custom event after createPersonProfile')
            posthog.createPersonProfile()

            // assert
            expect(beforeSendMock.mock.calls.length).toEqual(3)
        })

        it("should not send an event if process_person is to set to 'always'", async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('always')

            // act
            posthog.createPersonProfile()

            // assert
            expect(beforeSendMock).toBeCalledTimes(0)
            expect(mockLogger.error).toBeCalledTimes(0)
        })
    })

    describe('reset', () => {
        it('should revert a back to anonymous state in identified_only', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')
            posthog.identify(distinctId)
            posthog.capture('custom event before reset')

            // act
            posthog.reset()
            posthog.capture('custom event after reset')

            // assert
            expect(posthog._isIdentified()).toBe(false)
            expect(beforeSendMock.mock.calls.length).toEqual(3)
            expect(beforeSendMock.mock.calls[2][0].properties.$process_person_profile).toEqual(false)
        })
    })

    describe('persistence', () => {
        it('should remember that a user set the mode to always on a previous visit', async () => {
            // arrange
            const persistenceName = uuidv7()
            const { posthog: posthog1, beforeSendMock: beforeSendMock1 } = await setup(
                'always',
                undefined,
                persistenceName
            )
            posthog1.capture('custom event 1')
            const { posthog: posthog2, beforeSendMock: beforeSendMock2 } = await setup(
                'identified_only',
                undefined,
                persistenceName
            )

            // act
            posthog2.capture('custom event 2')

            // assert
            expect(beforeSendMock1.mock.calls.length).toEqual(1)
            expect(beforeSendMock2.mock.calls.length).toEqual(1)
            expect(beforeSendMock1.mock.calls[0][0].properties.$process_person_profile).toEqual(true)
            expect(beforeSendMock2.mock.calls[0][0].properties.$process_person_profile).toEqual(true)
        })

        it('should work when always is set on a later visit', async () => {
            // arrange
            const persistenceName = uuidv7()
            const { posthog: posthog1, beforeSendMock: beforeSendMock1 } = await setup(
                'identified_only',
                undefined,
                persistenceName
            )
            posthog1.capture('custom event 1')
            const { posthog: posthog2, beforeSendMock: beforeSendMock2 } = await setup(
                'always',
                undefined,
                persistenceName
            )

            // act
            posthog2.capture('custom event 2')

            // assert
            expect(beforeSendMock1.mock.calls.length).toEqual(1)
            expect(beforeSendMock2.mock.calls.length).toEqual(1)
            expect(beforeSendMock1.mock.calls[0][0].properties.$process_person_profile).toEqual(false)
            expect(beforeSendMock2.mock.calls[0][0].properties.$process_person_profile).toEqual(true)
        })
    })

    describe('flags', () => {
        it('should default the person mode to identified_only when an incomplete flags response is handled', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup(undefined)
            posthog.capture('startup page view')

            // act
            posthog._onRemoteConfig({} as RemoteConfig)
            posthog.capture('custom event')

            // assert
            expect(beforeSendMock.mock.calls.length).toEqual(2)
            expect(beforeSendMock.mock.calls[0][0].properties.$process_person_profile).toEqual(false)
            expect(beforeSendMock.mock.calls[1][0].properties.$process_person_profile).toEqual(false)
        })

        it('should NOT change the person mode from user-defined when flags response is handled', async () => {
            // arrange
            const { posthog, beforeSendMock } = await setup('identified_only')
            posthog.capture('startup page view')

            // act
            posthog._onRemoteConfig({ defaultIdentifiedOnly: false } as RemoteConfig)
            posthog.capture('custom event')

            // assert
            expect(beforeSendMock.mock.calls.length).toEqual(2)
            expect(beforeSendMock.mock.calls[0][0].properties.$process_person_profile).toEqual(false)
            expect(beforeSendMock.mock.calls[1][0].properties.$process_person_profile).toEqual(false)
        })
    })

    describe('property calls deduplication', () => {
        it('should deduplicate identical consecutive calls to setPersonProperties', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ email: 'john@example.com' })
            posthog.setPersonProperties({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledTimes(1)
            expect(beforeSendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: '$set',
                    properties: expect.objectContaining({
                        $set: { email: 'john@example.com' },
                        $set_once: {},
                    }),
                })
            )
        })

        it('should not deduplicate when properties are different', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ email: 'john@example.com' })
            posthog.setPersonProperties({ email: 'john.doe@example.com' })

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
        })

        it('should not deduplicate when set_once properties are different', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ email: 'john@example.com' }, { first_seen: 'today' })
            posthog.setPersonProperties({ email: 'john@example.com' }, { first_seen: 'yesterday' })

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
        })

        it('does not deduplicate when properties are in different order but identical', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ name: 'John', email: 'john@example.com' })
            posthog.setPersonProperties({ email: 'john@example.com', name: 'John' })

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
        })

        it('should log a message when deduping properties', async () => {
            const { posthog } = await setup('always')
            mockLogger.info = jest.fn()

            posthog.setPersonProperties({ email: 'john@example.com' })
            posthog.setPersonProperties({ email: 'john@example.com' })

            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('duplicate'))
        })

        it('should not deduplicate after distinct_id changes', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ email: 'john@example.com' })

            posthog.identify('new-id')

            posthog.setPersonProperties({ email: 'john@example.com' })

            const calls = beforeSendMock.mock.calls
            expect(calls.filter((call) => call[0].event === '$set').length).toEqual(2)
            expect(calls.filter((call) => call[0].event === '$identify').length).toEqual(1)
        })

        it('should deduplicate when using people.set with identical properties', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.people.set({ email: 'john@example.com' })
            posthog.people.set({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledTimes(1)
        })

        it('should deduplicate when mixing people.set and setPersonProperties with identical properties', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.people.set({ email: 'john@example.com' })
            posthog.setPersonProperties({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledTimes(1)
        })

        it('should deduplicate when using people.set_once with identical properties', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.people.set_once({ first_seen: 'today' })
            posthog.people.set_once({ first_seen: 'today' })

            expect(beforeSendMock).toHaveBeenCalledTimes(1)
        })

        it('should not deduplicate when mixing set and set_once with same properties', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.people.set({ email: 'john@example.com' })
            posthog.people.set_once({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
        })

        it('should reset deduplication cache after reset()', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ email: 'john@example.com' })
            posthog.reset()
            posthog.setPersonProperties({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
        })

        it('should deduplicate a setPersonProperties call after identify()', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.identify('new-id', { email: 'john@example.com' }, { first_seen: 'today' })
            posthog.setPersonProperties({ email: 'john@example.com' }, { first_seen: 'today' })

            expect(beforeSendMock).toHaveBeenCalledTimes(1)
            const calls = beforeSendMock.mock.calls
            expect(calls.filter((call) => call[0].event === '$identify').length).toEqual(1)
        })

        it('should not deduplicate a setPersonProperties call after identify() if the $set properties are different', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.identify('new-id', { email: 'john@example.com' }, { first_seen: 'today' })
            posthog.setPersonProperties({ email: 'jane@example.com' }, { first_seen: 'today' })

            const calls = beforeSendMock.mock.calls
            expect(calls.filter((call) => call[0].event === '$identify').length).toEqual(1)
            expect(calls.filter((call) => call[0].event === '$set').length).toEqual(1)
        })

        it('should not deduplicate a setPersonProperties call after identify() if the $set_onceproperties are different', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.identify('new-id', { email: 'john@example.com' }, { first_seen: 'today' })
            posthog.setPersonProperties({ email: 'john@example.com' }, { first_seen: 'yesterday' })

            const calls = beforeSendMock.mock.calls
            expect(calls.filter((call) => call[0].event === '$identify').length).toEqual(1)
            expect(calls.filter((call) => call[0].event === '$set').length).toEqual(1)
        })

        it('should not deduplicate a call after an identity change', async () => {
            const { posthog, beforeSendMock } = await setup('always')

            posthog.setPersonProperties({ email: 'john@example.com' })
            posthog.identify('new-id')
            posthog.setPersonProperties({ email: 'john@example.com' })

            const calls = beforeSendMock.mock.calls

            expect(calls.filter((call) => call[0].event === '$identify').length).toEqual(1)
            expect(calls.filter((call) => call[0].event === '$set').length).toEqual(2)
        })
    })
})
