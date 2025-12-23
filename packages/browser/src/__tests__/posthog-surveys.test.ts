/* eslint-disable compat/compat */
jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}))
jest.useFakeTimers()

import { SURVEYS, SURVEYS_REQUEST_TIMEOUT_MS } from '../constants'
import { SurveyManager } from '../extensions/surveys'
import { PostHog } from '../posthog-core'
import { PostHogSurveys } from '../posthog-surveys'
import { Survey, SurveySchedule, SurveyType } from '../posthog-surveys-types'
import { FlagsResponse } from '../types'
import { assignableWindow } from '../utils/globals'
import { SURVEY_IN_PROGRESS_PREFIX, SURVEY_SEEN_PREFIX } from '../utils/survey-utils'
import { createMockPostHog } from './helpers/posthog-instance'

describe('posthog-surveys', () => {
    describe('PostHogSurveys Class', () => {
        let mockPostHog: PostHog & {
            get_property: jest.Mock
            _send_request: jest.Mock
        }
        let surveys: PostHogSurveys
        let mockGenerateSurveys: jest.Mock
        let mockLoadExternalDependency: jest.Mock

        const survey: Survey = {
            id: 'completed-survey',
            name: 'completed survey',
            description: 'draft survey description',
            type: SurveyType.Popover,
            linked_flag_key: 'linked-flag-key',
            targeting_flag_key: 'targeting-flag-key',
            internal_targeting_flag_key: 'internal_targeting_flag_key',
            start_date: new Date('10/10/2022').toISOString(),
            conditions: {},
        } as unknown as Survey

        const repeatableSurvey: Survey = {
            ...survey,
            id: 'repeatable-survey',
            name: 'repeatable survey',
            type: SurveyType.Popover,
            schedule: SurveySchedule.Always,
        }

        const surveyWithWaitPeriod: Survey = {
            ...survey,
            id: 'survey-with-wait-period',
            name: 'survey with wait period',
            conditions: {
                seenSurveyWaitPeriodInDays: 7,
                events: null,
                cancelEvents: null,
                actions: null,
            },
        }

        const externalSurvey: Survey = {
            ...survey,
            id: 'external-survey',
            name: 'external survey',
            type: SurveyType.ExternalSurvey,
        }

        const flagsResponse = {
            featureFlags: {
                'linked-flag-key': true,
                'survey-targeting-flag-key': true,
                'linked-flag-key2': true,
                'survey-targeting-flag-key2': false,
                'enabled-internal-targeting-flag-key': true,
                'disabled-internal-targeting-flag-key': false,
            },
            surveys: true,
        } as unknown as FlagsResponse

        beforeEach(() => {
            // Reset mocks
            jest.clearAllMocks()

            // Clear localStorage
            localStorage.clear()

            // Mock PostHog instance
            mockPostHog = createMockPostHog({
                config: {
                    disable_surveys: false,
                    token: 'test-token',
                    surveys_request_timeout_ms: SURVEYS_REQUEST_TIMEOUT_MS,
                },
                persistence: {
                    register: jest.fn(),
                    props: {},
                },
                requestRouter: {
                    endpointFor: jest.fn().mockReturnValue('https://test.com/api/surveys'),
                },
                _send_request: jest.fn(),
                get_property: jest.fn(),
                consent: {
                    _instance: {} as any,
                    _config: {} as any,
                    consent: {} as any,
                    isOptedIn: jest.fn().mockReturnValue(true),
                    isOptedOut: jest.fn().mockReturnValue(false),
                    hasOptedInBefore: jest.fn().mockReturnValue(false),
                    hasOptedOutBefore: jest.fn().mockReturnValue(false),
                    optInCapturing: jest.fn(),
                    optOutCapturing: jest.fn(),
                    reset: jest.fn(),
                    onConsentChange: jest.fn(),
                },
                featureFlags: {
                    _send_request: jest
                        .fn()
                        .mockImplementation(({ callback }) => callback({ statusCode: 200, json: flagsResponse })),
                    getFeatureFlag: jest
                        .fn()
                        .mockImplementation((featureFlag) => flagsResponse.featureFlags[featureFlag]),
                    isFeatureEnabled: jest
                        .fn()
                        .mockImplementation((featureFlag) => flagsResponse.featureFlags[featureFlag]),
                },
            }) as PostHog & {
                get_property: jest.Mock
                _send_request: jest.Mock
            }

            // Create surveys instance
            surveys = new PostHogSurveys(mockPostHog as PostHog)

            // Mock window.__PosthogExtensions__
            mockGenerateSurveys = jest.fn()
            mockLoadExternalDependency = jest.fn()
            assignableWindow.__PosthogExtensions__ = {
                generateSurveys: mockGenerateSurveys,
                loadExternalDependency: mockLoadExternalDependency,
            }

            surveys.reset()
        })

        afterEach(() => {
            // Clean up
            delete assignableWindow.__PosthogExtensions__
            localStorage.clear()
        })

        describe('canRenderSurvey', () => {
            it('should return false if surveys are not loaded', () => {
                const result = surveys.canRenderSurvey(survey.id)
                expect(result.visible).toBeFalsy()
                expect(result.disabledReason).toEqual('SDK is not enabled or survey functionality is not yet loaded')
            })

            it('should return visible: true if surveys are loaded and the survey is eligible', () => {
                mockPostHog.get_property.mockReturnValue([survey])
                surveys['_surveyManager'] = new SurveyManager(mockPostHog as PostHog)
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = true
                const result = surveys.canRenderSurvey(survey.id)
                expect(result.visible).toBeTruthy()
                expect(result.disabledReason).toBeUndefined()
            })
        })

        describe('checkSurveyEligibility', () => {
            beforeEach(() => {
                // mock getSurveys response
                mockPostHog.get_property.mockReturnValue([
                    survey,
                    repeatableSurvey,
                    surveyWithWaitPeriod,
                    externalSurvey,
                ])
                surveys['_surveyManager'] = new SurveyManager(mockPostHog as PostHog)
            })

            it('cannot render completed surveys', () => {
                const completedSurvey = {
                    ...survey,
                    end_date: new Date('11/10/2022').toISOString(),
                }
                mockPostHog.get_property.mockReturnValue([completedSurvey])
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual(`Survey is not running. It was completed on ${completedSurvey.end_date}`)
            })

            it('cannot render survey if linked_flag is false', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual('Survey linked feature flag is not enabled')
            })

            it('cannot render survey if targeting_feature_flag is false', () => {
                flagsResponse.featureFlags[survey.linked_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.targeting_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual('Survey targeting feature flag is not enabled')
            })

            it('cannot render survey if internal_targeting_feature_flag is false', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual(
                    'Survey internal targeting flag is not enabled and survey cannot activate repeatedly and survey is not in progress'
                )
            })

            it('cannot render survey if linkedFlagVariant is not the same as the linked flag', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = 'cost'
                survey.conditions.linkedFlagVariant = 'control'
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual('Survey linked feature flag is not enabled for variant control')
                survey.conditions.linkedFlagVariant = undefined
            })

            it('can render survey if linkedFlagVariant is the same as the linked flag', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = 'variant'
                survey.conditions.linkedFlagVariant = 'variant'
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeTruthy()
                survey.conditions.linkedFlagVariant = undefined
            })

            it('can render survey if linkedFlagVariant is any', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = 'variant'
                survey.conditions.linkedFlagVariant = 'any'
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeTruthy()
                survey.conditions.linkedFlagVariant = undefined
            })

            it('can render if survey can activate repeatedly', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](repeatableSurvey.id)
                expect(result.eligible).toBeTruthy()
            })

            it('can render a survey that is in progress', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = false
                localStorage.setItem(
                    `${SURVEY_IN_PROGRESS_PREFIX}${survey.id}`,
                    JSON.stringify({
                        surveySubmissionId: '123',
                    })
                )
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeTruthy()
            })

            it('cannot render external surveys', () => {
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true

                const result = surveys['_checkSurveyEligibility'](externalSurvey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual(
                    'Surveys of type external_survey are never eligible to be shown in the app'
                )
            })

            describe('integration with wait period and survey seen checks', () => {
                beforeEach(() => {
                    // Set all flags to true for integration tests
                    flagsResponse.featureFlags[survey.targeting_flag_key] = true
                    flagsResponse.featureFlags[survey.linked_flag_key] = true
                    flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                    flagsResponse.featureFlags[surveyWithWaitPeriod.targeting_flag_key] = true
                    flagsResponse.featureFlags[surveyWithWaitPeriod.linked_flag_key] = true
                    flagsResponse.featureFlags[surveyWithWaitPeriod.internal_targeting_flag_key] = true
                })

                it('integrates wait period check with other eligibility criteria', () => {
                    // Set last seen survey date to 3 days ago (less than 7 day wait period)
                    const threeDaysAgo = new Date()
                    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
                    localStorage.setItem('lastSeenSurveyDate', threeDaysAgo.toISOString())

                    const result = surveys['_checkSurveyEligibility'](surveyWithWaitPeriod.id)
                    expect(result.eligible).toBeFalsy()
                    expect(result.reason).toEqual('Survey wait period has not passed')
                })

                it('integrates survey seen check with other eligibility criteria', () => {
                    // Mark survey as seen
                    localStorage.setItem(`${SURVEY_SEEN_PREFIX}${survey.id}`, 'true')

                    const result = surveys['_checkSurveyEligibility'](survey.id)
                    expect(result.eligible).toBeFalsy()
                    expect(result.reason).toEqual("Survey has already been seen and it can't be activated again")
                })

                it('allows repeatable surveys even when seen', () => {
                    // Use repeatable survey (has SurveySchedule.Always)
                    localStorage.setItem(`${SURVEY_SEEN_PREFIX}${repeatableSurvey.id}`, 'true')

                    const result = surveys['_checkSurveyEligibility'](repeatableSurvey.id)
                    expect(result.eligible).toBeTruthy()
                })
            })

            describe('check order and interaction between multiple eligibility criteria', () => {
                const surveyWithBothConditions: Survey = {
                    ...survey,
                    id: 'survey-with-both-conditions',
                    conditions: {
                        seenSurveyWaitPeriodInDays: 5,
                        events: null,
                        cancelEvents: null,
                        actions: null,
                    },
                }

                beforeEach(() => {
                    mockPostHog.get_property.mockReturnValue([surveyWithBothConditions])
                    // Set all flags to true
                    flagsResponse.featureFlags[surveyWithBothConditions.targeting_flag_key] = true
                    flagsResponse.featureFlags[surveyWithBothConditions.linked_flag_key] = true
                    flagsResponse.featureFlags[surveyWithBothConditions.internal_targeting_flag_key] = true
                })

                it('checks wait period before survey seen status (early return)', () => {
                    // Set last seen survey date to 2 days ago (less than 5 day wait period)
                    const twoDaysAgo = new Date()
                    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
                    localStorage.setItem('lastSeenSurveyDate', twoDaysAgo.toISOString())

                    // Also mark survey as seen (but this should not be checked since wait period fails first)
                    localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithBothConditions.id}`, 'true')

                    const result = surveys['_checkSurveyEligibility'](surveyWithBothConditions.id)
                    expect(result.eligible).toBeFalsy()
                    expect(result.reason).toEqual('Survey wait period has not passed')
                })

                it('checks survey seen status when wait period passes', () => {
                    // Set last seen survey date to 10 days ago (more than 5 day wait period)
                    const tenDaysAgo = new Date()
                    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
                    localStorage.setItem('lastSeenSurveyDate', tenDaysAgo.toISOString())

                    // Mark survey as seen and cannot repeat
                    localStorage.setItem(`${SURVEY_SEEN_PREFIX}${surveyWithBothConditions.id}`, 'true')

                    const result = surveys['_checkSurveyEligibility'](surveyWithBothConditions.id)
                    expect(result.eligible).toBeFalsy()
                    expect(result.reason).toEqual("Survey has already been seen and it can't be activated again")
                })

                it('allows surveys that pass all checks including repeatability', () => {
                    // Create a repeatable survey with wait period
                    const repeatableSurveyWithWaitPeriod: Survey = {
                        ...repeatableSurvey,
                        id: 'repeatable-survey-with-wait-period',
                        conditions: {
                            seenSurveyWaitPeriodInDays: 5,
                            events: null,
                            cancelEvents: null,
                            actions: null,
                        },
                    }
                    mockPostHog.get_property.mockReturnValue([repeatableSurveyWithWaitPeriod])

                    // Set last seen survey date to 10 days ago (more than 5 day wait period)
                    const tenDaysAgo = new Date()
                    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
                    localStorage.setItem('lastSeenSurveyDate', tenDaysAgo.toISOString())

                    // Mark survey as seen but can repeat (due to SurveySchedule.Always)
                    localStorage.setItem(`${SURVEY_SEEN_PREFIX}${repeatableSurveyWithWaitPeriod.id}`, 'true')

                    const result = surveys['_checkSurveyEligibility'](repeatableSurveyWithWaitPeriod.id)
                    expect(result.eligible).toBeTruthy()
                })
            })
        })

        describe('loadIfEnabled', () => {
            it('should not initialize if surveys are already loaded', () => {
                // Set surveyManager to simulate already loaded state
                surveys['_surveyManager'] = new SurveyManager(mockPostHog as PostHog)
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if already initializing', () => {
                // Set isInitializingSurveys to true
                surveys['_isInitializingSurveys'] = true
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if surveys are disabled', () => {
                mockPostHog.config.disable_surveys = true
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if PostHog Extensions are not found', () => {
                delete assignableWindow.__PosthogExtensions__
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if flags server response is not ready', () => {
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should set isInitializingSurveys to false after successful initialization', () => {
                // Set flags server response
                surveys['_isSurveysEnabled'] = true
                mockGenerateSurveys.mockReturnValue({})

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should set isInitializingSurveys to false after failed initialization', () => {
                // Set flags server response
                surveys['_isSurveysEnabled'] = true
                mockGenerateSurveys.mockImplementation(() => {
                    throw Error('Test error')
                })

                expect(() => surveys.loadIfEnabled()).toThrow('Test error')
                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should set isInitializingSurveys to false when loadExternalDependency fails', () => {
                // Set flags server response but no generateSurveys
                surveys['_isSurveysEnabled'] = true
                mockGenerateSurveys = undefined
                assignableWindow.__PosthogExtensions__.generateSurveys = undefined

                mockLoadExternalDependency.mockImplementation((_instance, _type, callback) => {
                    callback(new Error('Failed to load'))
                })

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should call the callback with the surveys when they are loaded', () => {
                surveys['_isSurveysEnabled'] = true
                mockGenerateSurveys.mockReturnValue({})
                const callback = jest.fn()
                const mockSurveys = [{ id: 'test-survey' }]
                mockPostHog.get_property.mockReturnValue(mockSurveys)

                surveys.onSurveysLoaded(callback)
                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
                expect(callback).toHaveBeenCalledWith(mockSurveys, {
                    isLoaded: true,
                })
                expect(callback).toHaveBeenCalledTimes(1)

                surveys.loadIfEnabled()
                // callback is only called once, even if surveys are loaded again
                expect(callback).toHaveBeenCalledTimes(1)
            })

            it('should call the callback with an error when surveys are not loaded', () => {
                surveys['_isSurveysEnabled'] = true
                mockGenerateSurveys.mockImplementation(() => {
                    throw new Error('Error initializing surveys')
                })
                const callback = jest.fn()

                surveys.onSurveysLoaded(callback)
                expect(() => surveys.loadIfEnabled()).toThrow('Error initializing surveys')

                expect(surveys['_isInitializingSurveys']).toBe(false)
                expect(callback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Error initializing surveys',
                })
                expect(callback).toHaveBeenCalledTimes(1)

                // callback is only called once, even if surveys are loaded again
                expect(callback).toHaveBeenCalledTimes(1)
            })

            it('should call onSurveysLoaded callback with surveys even when generateSurveys triggers an async fetch', () => {
                // This test reproduces a race condition on first page load:
                // 1. generateSurveys is called, which starts an async API fetch (sets _isFetchingSurveys = true)
                // 2. onSurveysLoaded callbacks fire, which call getSurveys
                // 3. getSurveys sees _isFetchingSurveys = true and returns empty array with error
                // 4. Later, the original fetch completes and surveys are rendered
                //
                // The expected behavior is that onSurveysLoaded should wait for the
                // in-flight fetch to complete and return the surveys.

                const mockSurveys = [{ id: 'test-survey' }]
                const callback = jest.fn()

                // No cached surveys (simulating first page load)
                mockPostHog.get_property.mockReturnValue(undefined)

                // Mock _send_request to simulate async API call
                mockPostHog._send_request.mockImplementation(({ callback: reqCallback }) => {
                    setTimeout(() => {
                        reqCallback({ statusCode: 200, json: { surveys: mockSurveys } })
                    }, 100)
                })

                // Mock generateSurveys to simulate what the real function does:
                // it calls getSurveys which starts the async fetch
                mockGenerateSurveys.mockImplementation(() => {
                    // This simulates callSurveysAndEvaluateDisplayLogic calling getSurveys
                    surveys.getSurveys(() => {}, true) // forceReload = true
                    return {} // return mock SurveyManager
                })

                surveys['_isSurveysEnabled'] = true
                surveys.onSurveysLoaded(callback)
                surveys.loadIfEnabled()

                // At this point, the callback was called but with empty array due to race condition
                // Let the async fetch complete
                jest.advanceTimersByTime(100)

                // The callback should have been called with the actual surveys, not empty array
                expect(callback).toHaveBeenCalledWith(mockSurveys, { isLoaded: true })
                expect(callback).not.toHaveBeenCalledWith([], expect.objectContaining({
                    error: 'Surveys are already being loaded',
                }))
            })

            it('should not load surveys in cookieless mode without consent', () => {
                mockPostHog.config.cookieless_mode = 'on_reject'
                const mockIsOptedOut = mockPostHog.consent.isOptedOut as jest.Mock
                mockIsOptedOut.mockReturnValue(true)
                surveys['_isSurveysEnabled'] = true

                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should load surveys in cookieless mode after consent is given', () => {
                mockPostHog.config.cookieless_mode = 'on_reject'
                const mockIsOptedOut = mockPostHog.consent.isOptedOut as jest.Mock
                mockIsOptedOut.mockReturnValue(false)
                surveys['_isSurveysEnabled'] = true
                mockGenerateSurveys.mockReturnValue({})

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
                expect(mockGenerateSurveys).toHaveBeenCalled()
            })
        })

        describe('getSurveys', () => {
            const mockCallback = jest.fn()
            const mockSurveys = [{ id: 'test-survey' }]

            beforeEach(() => {
                mockCallback.mockClear()
            })

            it('should return cached surveys and not fetch if they exist', () => {
                mockPostHog.get_property.mockReturnValue(mockSurveys)

                surveys.getSurveys(mockCallback)

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
                expect(mockCallback).toHaveBeenCalledWith(mockSurveys, {
                    isLoaded: true,
                })
                expect(surveys['_isFetchingSurveys']).toBe(false)
            })

            it('should queue callbacks when a fetch is in progress and call them when fetch completes', () => {
                // Simulate a fetch already in progress
                surveys['_isFetchingSurveys'] = true

                surveys.getSurveys(mockCallback)

                // Should not make a new API call
                expect(mockPostHog._send_request).not.toHaveBeenCalled()
                // Callback should be queued, not immediately called
                expect(mockCallback).not.toHaveBeenCalled()
                expect(surveys['_pendingFetchCallbacks']).toContain(mockCallback)
            })

            it('should call all pending callbacks when fetch fails', () => {
                const pendingCallback = jest.fn()

                mockPostHog._send_request.mockImplementation(({ callback: reqCallback }) => {
                    // Simulate queued callback before response arrives
                    surveys['_pendingFetchCallbacks'] = [pendingCallback]
                    reqCallback({ statusCode: 500 })
                })

                surveys.getSurveys(mockCallback)

                // Both callbacks should receive the error
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 500',
                })
                expect(pendingCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 500',
                })
                // Queue should be cleared
                expect(surveys['_pendingFetchCallbacks']).toEqual([])
            })

            it('should reset _isFetchingSurveys after successful API call', () => {
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    callback({ statusCode: 200, json: { surveys: mockSurveys } })
                })

                surveys.getSurveys(mockCallback)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith(mockSurveys, {
                    isLoaded: true,
                })
                expect(mockPostHog.persistence?.register).toHaveBeenCalledWith({ [SURVEYS]: mockSurveys })
            })

            it('should reset _isFetchingSurveys after failed API call (non-200 status)', () => {
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    callback({ statusCode: 500 })
                })

                surveys.getSurveys(mockCallback)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 500',
                })
            })

            it('should reset _isFetchingSurveys when API call throws error', () => {
                mockPostHog._send_request.mockImplementation(() => {
                    throw new Error('Network error')
                })

                expect(() => surveys.getSurveys(mockCallback)).toThrow('Network error')
                expect(surveys['_isFetchingSurveys']).toBe(false)
            })

            it('should reset _isFetchingSurveys when request times out', () => {
                // Mock a request that will timeout
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    // Simulate a timeout by calling callback with status 0
                    callback({ statusCode: 0, text: 'timeout' })
                })

                surveys.getSurveys(mockCallback)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 0',
                })
            })

            it('should handle delayed successful responses correctly', () => {
                const delayedSurveys = [{ id: 'delayed-survey' }]

                // Mock a request that takes some time to respond
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    setTimeout(() => {
                        callback({
                            statusCode: 200,
                            json: { surveys: delayedSurveys },
                        })
                    }, 100)
                })

                surveys.getSurveys(mockCallback)

                // Initially the flag should be true
                expect(surveys['_isFetchingSurveys']).toBe(true)

                // After the response comes in
                jest.advanceTimersByTime(100)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith(delayedSurveys, {
                    isLoaded: true,
                })
                expect(mockPostHog.persistence?.register).toHaveBeenCalledWith({ [SURVEYS]: delayedSurveys })
            })

            it('should set correct timeout value in request', () => {
                surveys.getSurveys(mockCallback)

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        timeout: SURVEYS_REQUEST_TIMEOUT_MS,
                    })
                )
            })

            it('should force reload surveys when forceReload is true', () => {
                mockPostHog.get_property.mockReturnValue(mockSurveys)

                surveys.getSurveys(mockCallback, true)

                expect(mockPostHog._send_request).toHaveBeenCalled()
            })
        })
    })
})
