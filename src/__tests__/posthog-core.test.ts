import { defaultPostHog } from './helpers/posthog-instance'
import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'
import { SurveyEventName, SurveyEventProperties } from '../posthog-surveys-types'
import { SURVEY_SEEN_PREFIX } from '../utils/survey-utils'

describe('posthog core', () => {
    const mockURL = jest.fn()
    const mockReferrer = jest.fn()

    beforeAll(() => {
        // Mock getters using Object.defineProperty
        Object.defineProperty(document, 'URL', {
            get: mockURL,
        })
        Object.defineProperty(document, 'referrer', {
            get: mockReferrer,
        })
        Object.defineProperty(window, 'location', {
            get: () => ({
                href: mockURL(),
                toString: () => mockURL(),
            }),
            configurable: true,
        })
    })

    beforeEach(() => {
        mockReferrer.mockReturnValue('https://referrer.com')
        mockURL.mockReturnValue('https://example.com')
        console.error = jest.fn()
    })

    it('exposes the version', () => {
        expect(defaultPostHog().version).toMatch(/\d+\.\d+\.\d+/)
    })

    describe('capture()', () => {
        const eventName = 'custom_event'
        const eventProperties = {
            event: 'prop',
        }
        const setup = (config: Partial<PostHogConfig> = {}, token: string = uuidv7()) => {
            const beforeSendMock = jest.fn().mockImplementation((e) => e)
            const posthog = defaultPostHog().init(token, { ...config, before_send: beforeSendMock }, token)!
            posthog.debug()
            return { posthog, beforeSendMock }
        }

        it('respects property_denylist and property_blacklist', () => {
            // arrange
            const { posthog } = setup({
                property_denylist: ['$lib', 'persistent', '$is_identified'],
                property_blacklist: ['token'],
            })

            // act
            const actual = posthog.calculateEventProperties(eventName, eventProperties, new Date())

            // assert
            expect(actual['event']).toBe('prop')
            expect(actual['$lib']).toBeUndefined()
            expect(actual['persistent']).toBeUndefined()
            expect(actual['$is_identified']).toBeUndefined()
            expect(actual['token']).toBeUndefined()
        })

        describe('rate limiting', () => {
            it('includes information about remaining rate limit', () => {
                const { posthog, beforeSendMock } = setup()

                posthog.capture(eventName, eventProperties)

                expect(beforeSendMock.mock.calls[0][0]).toMatchObject({
                    properties: {
                        $lib_rate_limit_remaining_tokens: 99,
                    },
                })
            })

            it('does not capture if rate limit is in place', () => {
                jest.useFakeTimers()
                jest.setSystemTime(Date.now())

                console.error = jest.fn()
                const { posthog, beforeSendMock } = setup()
                for (let i = 0; i < 100; i++) {
                    posthog.capture(eventName, eventProperties)
                }
                expect(beforeSendMock).toHaveBeenCalledTimes(100)
                beforeSendMock.mockClear()
                ;(console.error as any).mockClear()
                for (let i = 0; i < 50; i++) {
                    posthog.capture(eventName, eventProperties)
                }
                expect(beforeSendMock).toHaveBeenCalledTimes(1)
                expect(beforeSendMock.mock.calls[0][0].event).toBe('$$client_ingestion_warning')
                expect(console.error).toHaveBeenCalledTimes(50)
                expect(console.error).toHaveBeenCalledWith(
                    '[PostHog.js]',
                    'This capture call is ignored due to client rate limiting.'
                )
            })
        })

        describe('referrer', () => {
            it("should send referrer info with the event's properties", () => {
                // arrange
                const token = uuidv7()
                mockReferrer.mockReturnValue('https://referrer.example.com/some/path')
                const { posthog, beforeSendMock } = setup({
                    token,
                    persistence_name: token,
                    person_profiles: 'always',
                })

                // act
                posthog.capture(eventName, eventProperties)

                // assert
                const { $set_once, properties } = beforeSendMock.mock.calls[0][0]
                expect($set_once['$initial_referrer']).toBe('https://referrer.example.com/some/path')
                expect($set_once['$initial_referring_domain']).toBe('referrer.example.com')
                expect(properties['$referrer']).toBe('https://referrer.example.com/some/path')
                expect(properties['$referring_domain']).toBe('referrer.example.com')
            })

            it('should not update the referrer within the same session', () => {
                // arrange
                const token = uuidv7()
                mockReferrer.mockReturnValue('https://referrer1.example.com/some/path')
                const { posthog: posthog1 } = setup({
                    token,
                    persistence_name: token,
                    person_profiles: 'always',
                })
                posthog1.capture(eventName, eventProperties)
                mockReferrer.mockReturnValue('https://referrer2.example.com/some/path')
                const { posthog: posthog2, beforeSendMock } = setup({
                    token,
                    persistence_name: token,
                })

                // act
                posthog2.capture(eventName, eventProperties)

                // assert
                expect(posthog2.persistence!.props.$initial_person_info.r).toEqual(
                    'https://referrer1.example.com/some/path'
                )
                expect(posthog2.sessionPersistence!.props.$referrer).toEqual('https://referrer1.example.com/some/path')
                const { $set_once, properties } = beforeSendMock.mock.calls[0][0]
                expect($set_once['$initial_referrer']).toBe('https://referrer1.example.com/some/path')
                expect($set_once['$initial_referring_domain']).toBe('referrer1.example.com')
                expect(properties['$referrer']).toBe('https://referrer1.example.com/some/path')
                expect(properties['$referring_domain']).toBe('referrer1.example.com')
            })

            it('should use the new referrer in a new session', () => {
                // arrange
                const token = uuidv7()
                mockReferrer.mockReturnValue('https://referrer1.example.com/some/path')
                const { posthog: posthog1 } = setup({
                    token,
                    persistence_name: token,
                    person_profiles: 'always',
                })
                posthog1.capture(eventName, eventProperties)
                mockReferrer.mockReturnValue('https://referrer2.example.com/some/path')
                const { posthog: posthog2, beforeSendMock: beforeSendMock2 } = setup({
                    token,
                    persistence_name: token,
                })
                posthog2.sessionPersistence!.clear() // simulate a new session

                // act
                posthog2.capture(eventName, eventProperties)

                // assert
                expect(posthog2.persistence!.props.$initial_person_info.r).toEqual(
                    'https://referrer1.example.com/some/path'
                )
                const { $set_once, properties } = beforeSendMock2.mock.calls[0][0]
                expect($set_once['$initial_referrer']).toBe('https://referrer1.example.com/some/path')
                expect($set_once['$initial_referring_domain']).toBe('referrer1.example.com')
                expect(properties['$referrer']).toBe('https://referrer2.example.com/some/path')
                expect(properties['$referring_domain']).toBe('referrer2.example.com')
            })

            it('should use $direct when there is no referrer', () => {
                // arrange
                const token = uuidv7()
                mockReferrer.mockReturnValue('')
                const { posthog, beforeSendMock } = setup({
                    token,
                    persistence_name: token,
                    person_profiles: 'always',
                })

                // act
                posthog.capture(eventName, eventProperties)

                // assert
                const { $set_once, properties } = beforeSendMock.mock.calls[0][0]
                expect($set_once['$initial_referrer']).toBe('$direct')
                expect($set_once['$initial_referring_domain']).toBe('$direct')
                expect(properties['$referrer']).toBe('$direct')
                expect(properties['$referring_domain']).toBe('$direct')
            })
        })

        describe('campaign params', () => {
            it('should not send campaign params as null if there are no non-null ones', () => {
                // arrange
                const token = uuidv7()
                mockURL.mockReturnValue('https://www.example.com/some/path')
                const { posthog, beforeSendMock } = setup({
                    token,
                    persistence_name: token,
                })

                // act
                posthog.capture('$pageview')

                //assert
                expect(beforeSendMock.mock.calls[0][0].properties).not.toHaveProperty('utm_source')
                expect(beforeSendMock.mock.calls[0][0].properties).not.toHaveProperty('utm_medium')
            })

            it('should send present campaign params, and nulls for others', () => {
                // arrange
                const token = uuidv7()
                mockURL.mockReturnValue('https://www.example.com/some/path?utm_source=source')
                const { posthog, beforeSendMock } = setup({
                    token,
                    persistence_name: token,
                })

                // act
                posthog.capture('$pageview')

                //assert
                expect(beforeSendMock.mock.calls[0][0].properties.utm_source).toBe('source')
                expect(beforeSendMock.mock.calls[0][0].properties.utm_medium).toBe(null)
            })
        })

        describe('survey events', () => {
            it('sending survey sent events should mark it as seen in localStorage and set the interaction property', () => {
                // arrange
                const { posthog, beforeSendMock } = setup({ debug: false })
                const survey = {
                    id: 'testSurvey1',
                    current_iteration: 1,
                }
                const surveySeenKey = `${SURVEY_SEEN_PREFIX}${survey.id}_${survey.current_iteration}`

                // act
                posthog.capture(SurveyEventName.SENT, {
                    [SurveyEventProperties.SURVEY_ID]: survey.id,
                    [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
                })

                // assert
                expect(localStorage.getItem(surveySeenKey)).toBe('true')
                // test if property contains at least $set but dont care about the other properties
                expect(beforeSendMock.mock.calls[0][0]).toMatchObject({
                    properties: {
                        [SurveyEventProperties.SURVEY_ID]: survey.id,
                        [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
                    },
                    $set: {
                        '$survey_responded/testSurvey1/1': true,
                    },
                })
            })
            it('sending survey dismissed events should mark it as seen in localStorage and set the interaction property', () => {
                // arrange
                const { posthog, beforeSendMock } = setup({ debug: false })
                const survey = {
                    id: 'testSurvey1',
                    current_iteration: 1,
                }
                const surveySeenKey = `${SURVEY_SEEN_PREFIX}${survey.id}_${survey.current_iteration}`

                // act
                posthog.capture(SurveyEventName.DISMISSED, {
                    [SurveyEventProperties.SURVEY_ID]: survey.id,
                    [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
                })

                // assert
                expect(localStorage.getItem(surveySeenKey)).toBe('true')
                // test if property contains at least $set but dont care about the other properties
                expect(beforeSendMock.mock.calls[0][0]).toMatchObject({
                    properties: {
                        [SurveyEventProperties.SURVEY_ID]: survey.id,
                        [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
                    },
                    $set: {
                        '$survey_dismissed/testSurvey1/1': true,
                    },
                })
            })
        })
    })
})
