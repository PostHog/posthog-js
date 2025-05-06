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
import { DecideResponse } from '../types'
import { assignableWindow } from '../utils/globals'
import { SURVEY_IN_PROGRESS_PREFIX } from '../utils/survey-utils'

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
        } as unknown as Survey

        const repeatableSurvey: Survey = {
            ...survey,
            id: 'repeatable-survey',
            name: 'repeatable survey',
            type: SurveyType.Popover,
            schedule: SurveySchedule.Always,
        }

        const decideResponse = {
            featureFlags: {
                'linked-flag-key': true,
                'survey-targeting-flag-key': true,
                'linked-flag-key2': true,
                'survey-targeting-flag-key2': false,
                'enabled-internal-targeting-flag-key': true,
                'disabled-internal-targeting-flag-key': false,
            },
            surveys: true,
        } as unknown as DecideResponse

        beforeEach(() => {
            // Reset mocks
            jest.clearAllMocks()

            // Mock PostHog instance
            mockPostHog = {
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
                featureFlags: {
                    _send_request: jest
                        .fn()
                        .mockImplementation(({ callback }) => callback({ statusCode: 200, json: decideResponse })),
                    getFeatureFlag: jest
                        .fn()
                        .mockImplementation((featureFlag) => decideResponse.featureFlags[featureFlag]),
                    isFeatureEnabled: jest
                        .fn()
                        .mockImplementation((featureFlag) => decideResponse.featureFlags[featureFlag]),
                },
            } as unknown as PostHog & {
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
                canActivateRepeatedly: jest.fn().mockReturnValue(false),
            }

            surveys.reset()
        })

        afterEach(() => {
            // Clean up
            delete assignableWindow.__PosthogExtensions__
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
                decideResponse.featureFlags[survey.targeting_flag_key] = true
                decideResponse.featureFlags[survey.internal_targeting_flag_key] = true
                decideResponse.featureFlags[survey.linked_flag_key] = true
                const result = surveys.canRenderSurvey(survey.id)
                expect(result.visible).toBeTruthy()
                expect(result.disabledReason).toBeUndefined()
            })
        })

        describe('checkSurveyEligibility', () => {
            beforeEach(() => {
                // mock getSurveys response
                mockPostHog.get_property.mockReturnValue([survey, repeatableSurvey])
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
                decideResponse.featureFlags[survey.targeting_flag_key] = true
                decideResponse.featureFlags[survey.internal_targeting_flag_key] = true
                decideResponse.featureFlags[survey.linked_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual('Survey linked feature flag is not enabled')
            })

            it('cannot render survey if targeting_feature_flag is false', () => {
                decideResponse.featureFlags[survey.linked_flag_key] = true
                decideResponse.featureFlags[survey.internal_targeting_flag_key] = true
                decideResponse.featureFlags[survey.targeting_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual('Survey targeting feature flag is not enabled')
            })

            it('cannot render survey if internal_targeting_feature_flag is false', () => {
                decideResponse.featureFlags[survey.targeting_flag_key] = true
                decideResponse.featureFlags[survey.linked_flag_key] = true
                decideResponse.featureFlags[survey.internal_targeting_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeFalsy()
                expect(result.reason).toEqual(
                    'Survey internal targeting flag is not enabled and survey cannot activate repeatedly and survey is not in progress'
                )
            })

            it('can render if survey can activate repeatedly', () => {
                decideResponse.featureFlags[survey.targeting_flag_key] = true
                decideResponse.featureFlags[survey.linked_flag_key] = true
                decideResponse.featureFlags[survey.internal_targeting_flag_key] = false
                const result = surveys['_checkSurveyEligibility'](repeatableSurvey.id)
                expect(result.eligible).toBeTruthy()
            })

            it('can render a survey that is in progress', () => {
                decideResponse.featureFlags[survey.targeting_flag_key] = true
                decideResponse.featureFlags[survey.linked_flag_key] = true
                decideResponse.featureFlags[survey.internal_targeting_flag_key] = false
                localStorage.setItem(
                    `${SURVEY_IN_PROGRESS_PREFIX}${survey.id}`,
                    JSON.stringify({
                        surveySubmissionId: '123',
                    })
                )
                const result = surveys['_checkSurveyEligibility'](survey.id)
                expect(result.eligible).toBeTruthy()
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

            it('should not initialize if decide server response is not ready', () => {
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should set isInitializingSurveys to false after successful initialization', () => {
                // Set decide server response
                surveys['_hasSurveys'] = true
                mockGenerateSurveys.mockReturnValue({})

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should set isInitializingSurveys to false after failed initialization', () => {
                // Set decide server response
                surveys['_hasSurveys'] = true
                mockGenerateSurveys.mockImplementation(() => {
                    throw Error('Test error')
                })

                expect(() => surveys.loadIfEnabled()).toThrow('Test error')
                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should set isInitializingSurveys to false when loadExternalDependency fails', () => {
                // Set decide server response but no generateSurveys
                surveys['_hasSurveys'] = true
                mockGenerateSurveys = undefined
                assignableWindow.__PosthogExtensions__.generateSurveys = undefined

                mockLoadExternalDependency.mockImplementation((_instance, _type, callback) => {
                    callback(new Error('Failed to load'))
                })

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should call the callback with the surveys when they are loaded', () => {
                surveys['_hasSurveys'] = true
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
                surveys['_hasSurveys'] = true
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

            it('should not make concurrent API calls', () => {
                surveys['_isFetchingSurveys'] = true

                surveys.getSurveys(mockCallback)

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys are already being loaded',
                })
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
