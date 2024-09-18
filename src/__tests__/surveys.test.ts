/// <reference lib="dom" />

import { PostHogSurveys } from '../posthog-surveys'
import {
    SurveyType,
    SurveyQuestionType,
    Survey,
    MultipleSurveyQuestion,
    SurveyQuestionBranchingType,
    SurveyQuestion,
    RatingSurveyQuestion,
} from '../posthog-surveys-types'
import {
    canActivateRepeatedly,
    getDisplayOrderChoices,
    getDisplayOrderQuestions,
} from '../extensions/surveys/surveys-utils'
import { PostHogPersistence } from '../posthog-persistence'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig, Properties } from '../types'
import { window } from '../utils/globals'
import { RequestRouter } from '../utils/request-router'
import { assignableWindow } from '../utils/globals'
import { generateSurveys } from '../extensions/surveys'

describe('surveys', () => {
    let config: PostHogConfig
    let instance: PostHog
    let surveys: PostHogSurveys
    let surveysResponse: { status?: number; surveys?: Survey[] }
    const originalWindowLocation = assignableWindow.location

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

    const firstSurveys: Survey[] = [
        {
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
        } as unknown as Survey,
    ]

    const secondSurveys: Survey[] = [
        {
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
        } as unknown as Survey,
        {
            name: 'second survey',
            description: 'second survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a moblin?' }],
        } as unknown as Survey,
    ]
    const surveysWithEvents: Survey[] = [
        {
            name: 'first survey',
            id: 'first-survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
            conditions: {
                events: {
                    values: [
                        {
                            name: 'user_subscribed',
                        },
                        {
                            name: 'user_unsubscribed',
                        },
                        {
                            name: 'billing_changed',
                        },
                        {
                            name: 'billing_removed',
                        },
                    ],
                },
            },
        } as unknown as Survey,
        {
            name: 'second survey',
            id: 'second-survey',
            description: 'second survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a moblin?' }],
        } as unknown as Survey,
        {
            name: 'third survey',
            id: 'third-survey',
            description: 'third survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
            conditions: {
                events: {
                    values: [
                        {
                            name: 'user_subscribed',
                        },
                        {
                            name: 'user_unsubscribed',
                        },
                        {
                            name: 'address_changed',
                        },
                    ],
                },
            },
        } as unknown as Survey,
    ]

    beforeEach(() => {
        surveysResponse = { surveys: firstSurveys }

        const loadScriptMock = jest.fn()

        loadScriptMock.mockImplementation((_path, callback) => {
            assignableWindow.__PosthogExtensions__ = assignableWindow.__Posthog__ || {}
            assignableWindow.extendPostHogWithSurveys = generateSurveys
            assignableWindow.__PosthogExtensions__.canActivateRepeatedly = canActivateRepeatedly

            callback()
        })

        config = {
            token: 'testtoken',
            api_host: 'https://app.posthog.com',
            persistence: 'memory',
        } as unknown as PostHogConfig

        instance = {
            config: config,
            persistence: new PostHogPersistence(config),
            requestRouter: new RequestRouter({ config } as any),
            _addCaptureHook: jest.fn(),
            register: (props: Properties) => instance.persistence?.register(props),
            unregister: (key: string) => instance.persistence?.unregister(key),
            get_property: (key: string) => instance.persistence?.props[key],
            _send_request: jest
                .fn()
                .mockImplementation(({ callback }) => callback({ statusCode: 200, json: surveysResponse })),
            featureFlags: {
                _send_request: jest
                    .fn()
                    .mockImplementation(({ callback }) => callback({ statusCode: 200, json: decideResponse })),
                getFeatureFlag: jest.fn().mockImplementation((featureFlag) => decideResponse.featureFlags[featureFlag]),
                isFeatureEnabled: jest
                    .fn()
                    .mockImplementation((featureFlag) => decideResponse.featureFlags[featureFlag]),
            },
        } as unknown as PostHog

        instance.requestRouter.loadScript = loadScriptMock

        surveys = new PostHogSurveys(instance)
        instance.surveys = surveys
        // all being squashed into a mock posthog so...
        instance.getActiveMatchingSurveys = instance.surveys.getActiveMatchingSurveys.bind(instance.surveys)

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,
            // eslint-disable-next-line compat/compat
            value: new URL('https://example.com'),
        })

        surveys.afterDecideResponse(decideResponse)
    })

    afterEach(() => {
        instance.persistence?.clear()

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            value: originalWindowLocation,
        })
    })

    it('getSurveys gets a list of surveys if not present already', () => {
        surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        expect(instance._send_request).toHaveBeenCalledWith({
            url: 'https://us.i.posthog.com/api/surveys/?token=testtoken',
            method: 'GET',
            transport: 'XHR',
            callback: expect.any(Function),
        })
        expect(instance._send_request).toHaveBeenCalledTimes(1)
        expect(instance.persistence?.props.$surveys).toEqual(firstSurveys)

        surveysResponse = { surveys: secondSurveys }
        surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        // request again, shouldn't call _send_request again, so 1 total call instead of 2
        expect(instance._send_request).toHaveBeenCalledTimes(1)
    })

    it('getSurveys registers the survey event receiver if a survey has events', () => {
        surveysResponse = { surveys: surveysWithEvents }
        surveys.getSurveys((data) => {
            expect(data).toEqual(surveysWithEvents)
        }, true)

        const registry = surveys._surveyEventReceiver?.getEventToSurveys()
        expect(registry.has('user_subscribed')).toBeTruthy()
        expect(registry.get('user_subscribed')).toEqual(['first-survey', 'third-survey'])

        expect(registry.has('address_changed')).toBeTruthy()
        expect(registry.get('address_changed')).toEqual(['third-survey'])
    })

    it('getSurveys force reloads when called with true', () => {
        surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        expect(instance._send_request).toHaveBeenCalledWith({
            url: 'https://us.i.posthog.com/api/surveys/?token=testtoken',
            method: 'GET',
            transport: 'XHR',
            callback: expect.any(Function),
        })
        expect(instance._send_request).toHaveBeenCalledTimes(1)
        expect(instance.persistence?.props.$surveys).toEqual(firstSurveys)

        surveysResponse = { surveys: secondSurveys }

        surveys.getSurveys((data) => {
            expect(data).toEqual(secondSurveys)
        }, true)
        expect(instance.persistence?.props.$surveys).toEqual(secondSurveys)
        expect(instance._send_request).toHaveBeenCalledTimes(2)
    })

    it('getSurveys returns empty array if surveys are undefined', () => {
        surveysResponse = { status: 0 }
        surveys.getSurveys((data) => {
            expect(data).toEqual([])
        })
    })

    it('getSurveys returns empty array if surveys are disabled', () => {
        instance.config.disable_surveys = true
        surveys.getSurveys((data) => {
            expect(data).toEqual([])
        })
        expect(instance._send_request).not.toHaveBeenCalled()
    })

    describe('getActiveMatchingSurveys', () => {
        const draftSurvey: Survey = {
            name: 'draft survey',
            description: 'draft survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a draft survey?' }],
            start_date: null,
        } as unknown as Survey
        const activeSurvey: Survey = {
            name: 'active survey',
            description: 'active survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a active survey?' }],
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const completedSurvey: Survey = {
            name: 'completed survey',
            description: 'completed survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a completed survey?' }],
            start_date: new Date('09/10/2022').toISOString(),
            end_date: new Date('10/10/2022').toISOString(),
        } as unknown as Survey
        const surveyWithUrl: Survey = {
            name: 'survey with url',
            description: 'survey with url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with url?' }],
            conditions: { url: 'posthog.com' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithRegexUrl: Survey = {
            name: 'survey with regex url',
            description: 'survey with regex url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with regex url?' }],
            conditions: { url: 'regex-url', urlMatchType: 'regex' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithUrlDoesNotContainRegex: Survey = {
            name: 'survey with url does not contain regex',
            description: 'survey with url does not contain regex description',
            type: SurveyType.Popover,
            questions: [
                { type: SurveyQuestionType.Open, question: 'what is a survey with url does not contain regex?' },
            ],
            conditions: { url: 'regex-url', urlMatchType: 'not_regex' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithParamRegexUrl: Survey = {
            name: 'survey with param regex url',
            description: 'survey with param regex url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with param regex url?' }],
            conditions: { url: '(\\?|\\&)(name.*)\\=([^&]+)', urlMatchType: 'regex' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithWildcardSubdomainUrl: Survey = {
            name: 'survey with wildcard subdomain url',
            description: 'survey with wildcard subdomain url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with wildcard subdomain url?' }],
            conditions: { url: '(.*.)?subdomain.com', urlMatchType: 'regex' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithWildcardRouteUrl: Survey = {
            name: 'survey with wildcard route url',
            description: 'survey with wildcard route url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with wildcard route url?' }],
            conditions: { url: 'wildcard.com/(.*.)', urlMatchType: 'regex' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithExactUrlMatch: Survey = {
            name: 'survey with wildcard route url',
            description: 'survey with wildcard route url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with wildcard route url?' }],
            conditions: { url: 'https://example.com/exact', urlMatchType: 'exact' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithIsNotUrlMatch: Survey = {
            name: 'survey with is not url match',
            description: 'survey with is not url match description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with is not url match?' }],
            conditions: { url: 'https://example.com/exact', urlMatchType: 'is_not' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithUrlDoesNotContain: Survey = {
            name: 'survey with url does not contain',
            description: 'survey with url does not contain description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with url does not contain?' }],
            conditions: { url: 'posthog.com', urlMatchType: 'not_icontains' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithSelector: Survey = {
            name: 'survey with selector',
            description: 'survey with selector description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with selector?' }],
            conditions: { selector: '.test-selector' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithUrlAndSelector: Survey = {
            name: 'survey with url and selector',
            description: 'survey with url and selector description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with url and selector?' }],
            conditions: { url: 'posthogapp.com', selector: '#foo' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithFlags: Survey = {
            name: 'survey with flags',
            description: 'survey with flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key',
            targeting_flag_key: 'survey-targeting-flag-key',
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithUnmatchedFlags: Survey = {
            name: 'survey with flags2',
            description: 'survey with flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key2',
            targeting_flag_key: 'survey-targeting-flag-key2',
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithEnabledInternalFlag: Survey = {
            name: 'survey with enabled internal flags',
            description: 'survey with flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key',
            internal_targeting_flag_key: 'enabled-internal-targeting-flag-key',
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithDisabledInternalFlag: Survey = {
            name: 'survey with disabled internal flag',
            description: 'survey with flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key2',
            internal_targeting_flag_key: 'disabled-internal-targeting-flag-key',
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithEvents: Survey = {
            name: 'survey with events',
            description: 'survey with events description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key',
            internal_targeting_flag_key: 'enabled-internal-targeting-flag-key',
            conditions: {
                events: {
                    values: [
                        {
                            name: 'user_subscribed',
                        },
                        {
                            name: 'user_unsubscribed',
                        },
                    ],
                },
            },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithEverything: Survey = {
            name: 'survey with everything',
            description: 'survey with everything description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with everything?' }],
            start_date: new Date().toISOString(),
            end_date: null,
            conditions: { url: 'posthogapp.com', selector: '.test-selector' },
            linked_flag_key: 'linked-flag-key',
            targeting_flag_key: 'survey-targeting-flag-key',
        } as unknown as Survey

        it('returns surveys that are active', () => {
            surveysResponse = { surveys: [draftSurvey, activeSurvey, completedSurvey] }

            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([activeSurvey])
            })
        })

        it('returns surveys based on url and selector matching', () => {
            surveysResponse = {
                surveys: [surveyWithUrl, surveyWithSelector, surveyWithUrlAndSelector],
            }
            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://posthog.com') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithUrl])
            })
            assignableWindow.location = originalWindowLocation

            document.body.appendChild(document.createElement('div')).className = 'test-selector'
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithSelector])
            })
            const testSelectorEl = document!.querySelector('.test-selector')
            if (testSelectorEl) {
                document.body.removeChild(testSelectorEl)
            }

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://posthogapp.com') as unknown as Location
            document.body.appendChild(document.createElement('div')).id = 'foo'

            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithUrlAndSelector])
            })
            const child = document.querySelector('#foo')
            if (child) {
                document.body.removeChild(child)
            }
        })

        it('returns surveys based on url with urlMatchType settings', () => {
            surveysResponse = {
                surveys: [
                    surveyWithRegexUrl,
                    surveyWithParamRegexUrl,
                    surveyWithWildcardRouteUrl,
                    surveyWithWildcardSubdomainUrl,
                    surveyWithExactUrlMatch,
                ],
            }

            const originalWindowLocation = assignableWindow.location
            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://regex-url.com/test') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithRegexUrl])
            })
            assignableWindow.location = originalWindowLocation

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://example.com?name=something') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithParamRegexUrl])
            })
            assignableWindow.location = originalWindowLocation

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://app.subdomain.com') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithWildcardSubdomainUrl])
            })
            assignableWindow.location = originalWindowLocation

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://wildcard.com/something/other') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithWildcardRouteUrl])
            })
            assignableWindow.location = originalWindowLocation

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://example.com/exact') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithExactUrlMatch])
            })
            assignableWindow.location = originalWindowLocation
        })

        it('returns surveys based on exclusion conditions', () => {
            surveysResponse = {
                surveys: [surveyWithUrlDoesNotContain, surveyWithIsNotUrlMatch, surveyWithUrlDoesNotContainRegex],
            }

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://posthog.com') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithIsNotUrlMatch and surveyWithUrlDoesNotContainRegex because they don't contain posthog.com
                expect(data).toEqual([surveyWithIsNotUrlMatch, surveyWithUrlDoesNotContainRegex])
            })
            assignableWindow.location = originalWindowLocation

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://example.com/exact') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithUrlDoesNotContain and surveyWithUrlDoesNotContainRegex because they are not exact matches
                expect(data).toEqual([surveyWithUrlDoesNotContain, surveyWithUrlDoesNotContainRegex])
            })
            assignableWindow.location = originalWindowLocation

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://regex-url.com/test') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithUrlDoesNotContain and surveyWithIsNotUrlMatch because they are not regex matches
                expect(data).toEqual([surveyWithUrlDoesNotContain, surveyWithIsNotUrlMatch])
            })
            assignableWindow.location = originalWindowLocation
        })

        it('returns surveys that match linked and targeting feature flags', () => {
            surveysResponse = { surveys: [activeSurvey, surveyWithFlags, surveyWithEverything] }
            surveys.getActiveMatchingSurveys((data) => {
                // active survey is returned because it has no flags aka there are no restrictions on flag enabled for it
                expect(data).toEqual([activeSurvey, surveyWithFlags])
            })
        })

        it('does not return surveys that have flag keys but no matching flags', () => {
            surveysResponse = { surveys: [surveyWithFlags, surveyWithUnmatchedFlags] }
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithFlags])
            })
        })

        it('returns surveys that match internal feature flags', () => {
            surveysResponse = {
                surveys: [surveyWithEnabledInternalFlag, surveyWithDisabledInternalFlag],
            }
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithEnabledInternalFlag])
            })
        })

        it('does not return event based surveys that didnt observe an event', () => {
            surveysResponse = {
                surveys: [surveyWithEnabledInternalFlag, surveyWithEvents],
            }
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithEnabledInternalFlag])
            })
        })

        it('returns event based surveys that observed an event', () => {
            // TODO this test fails when run in isolation

            surveysResponse = {
                surveys: [surveyWithEnabledInternalFlag, surveyWithEvents],
            }
            ;(surveys._surveyEventReceiver as any)?.on('user_subscribed')
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithEnabledInternalFlag])
            })
        })
        it('does not return surveys that have internal flag keys but no matching internal flags', () => {
            surveysResponse = { surveys: [surveyWithEnabledInternalFlag, surveyWithDisabledInternalFlag] }
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithEnabledInternalFlag])
            })
        })

        it('returns surveys that inclusively matches any of the above', () => {
            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://posthogapp.com') as unknown as Location
            document.body.appendChild(document.createElement('div')).className = 'test-selector'
            surveysResponse = { surveys: [activeSurvey, surveyWithSelector, surveyWithEverything] }
            // activeSurvey returns because there are no restrictions on conditions or flags on it
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([activeSurvey, surveyWithSelector, surveyWithEverything])
            })
        })
    })

    describe('shuffling questions', () => {
        const surveyWithoutShufflingQuestions: Survey = {
            name: 'survey without shuffling questions',
            description: 'survey without shuffling questions',
            type: SurveyType.Popover,
            questions: [
                { type: SurveyQuestionType.Open, question: 'Question A' },
                { type: SurveyQuestionType.Open, question: 'Question B' },
            ],
            start_date: new Date().toISOString(),
            end_date: null,
            appearance: {
                shuffleQuestions: false,
            },
        } as unknown as Survey

        const surveyWithShufflingQuestions: Survey = {
            name: 'survey without shuffling questions',
            description: 'survey without shuffling questions',
            type: SurveyType.Popover,
            questions: [
                { type: SurveyQuestionType.Open, question: 'Question A' },
                { type: SurveyQuestionType.Open, question: 'Question B' },
                { type: SurveyQuestionType.Open, question: 'Question C' },
                { type: SurveyQuestionType.Open, question: 'Question D' },
                { type: SurveyQuestionType.Open, question: 'Question E' },
            ],
            start_date: new Date().toISOString(),
            end_date: null,
            appearance: {
                shuffleQuestions: true,
            },
        } as unknown as Survey

        it('should not shuffle questions if shuffleQuestions is false', () => {
            expect(surveyWithoutShufflingQuestions.questions).toEqual(
                getDisplayOrderQuestions(surveyWithoutShufflingQuestions)
            )
        })

        it('should shuffle questions if shuffleQuestions is true', () => {
            expect(surveyWithShufflingQuestions.questions).not.toEqual(
                getDisplayOrderQuestions(surveyWithShufflingQuestions)
            )
        })

        it('should retain original index of question if shuffleQuestions is true', () => {
            const shuffledQuestions = getDisplayOrderQuestions(surveyWithShufflingQuestions)
            console.log('************************************', shuffledQuestions)
            for (let i = 0; i < shuffledQuestions.length; i++) {
                const originalQuestionIndex = shuffledQuestions[i].originalQuestionIndex
                expect(shuffledQuestions[i].question).toEqual(
                    surveyWithShufflingQuestions.questions[originalQuestionIndex].question
                )
            }
        })

        it('shuffle should preserve all elements', () => {
            const shuffledQuestions = getDisplayOrderQuestions(surveyWithShufflingQuestions)

            const sortedQuestions = surveyWithShufflingQuestions.questions.sort(function (a, b) {
                return a.question.localeCompare(b.question)
            })

            expect(sortedQuestions.length).toEqual(shuffledQuestions.length)
            const sortedShuffledQuestions = shuffledQuestions.sort(function (a, b) {
                return a.question.localeCompare(b.question)
            })
            expect(sortedQuestions).toEqual(sortedShuffledQuestions)
        })
    })

    describe('shuffling options', () => {
        const questionWithoutShufflingOptions: MultipleSurveyQuestion = {
            type: SurveyQuestionType.MultipleChoice,
            question: "We're sorry to see you go. What's your reason for unsubscribing?",
            choices: [
                'I no longer need the product',
                'I found a better product',
                'I found the product too difficult to use',
                'Other',
            ],
            hasOpenChoice: true,
            shuffleOptions: false,
        } as unknown as MultipleSurveyQuestion

        const questionWithShufflingOptions: MultipleSurveyQuestion = {
            type: SurveyQuestionType.MultipleChoice,
            question: "We're sorry to see you go. What's your reason for unsubscribing?",
            choices: [
                'I no longer need the product',
                'I found a better product',
                'I found the product too difficult to use',
                'Other',
            ],
            hasOpenChoice: true,
            shuffleOptions: true,
        } as unknown as MultipleSurveyQuestion

        const questionWithOpenEndedChoice: MultipleSurveyQuestion = {
            type: SurveyQuestionType.MultipleChoice,
            question: "We're sorry to see you go. What's your reason for unsubscribing?",
            choices: [
                'I no longer need the product',
                'I found a better product',
                'I found the product too difficult to use',
                'open-ended-choice',
            ],
            hasOpenChoice: true,
            shuffleOptions: true,
        } as unknown as MultipleSurveyQuestion

        it('should not shuffle if shuffleOptions is false', () => {
            const shuffledOptions = getDisplayOrderChoices(questionWithoutShufflingOptions)
            expect(shuffledOptions).toEqual(questionWithoutShufflingOptions.choices)
        })

        it('should shuffle if shuffleOptions is true', () => {
            const shuffledOptions = getDisplayOrderChoices(questionWithShufflingOptions)
            expect(shuffledOptions).not.toEqual(questionWithShufflingOptions.choices)
        })

        it('should keep open-ended coice as the last option', () => {
            let shuffledOptions = getDisplayOrderChoices(questionWithOpenEndedChoice)
            shuffledOptions = getDisplayOrderChoices(questionWithOpenEndedChoice)
            expect(shuffledOptions.pop()).toEqual('open-ended-choice')
        })

        it('shuffle should preserve all elements', () => {
            const shuffledOptions = getDisplayOrderChoices(questionWithOpenEndedChoice)
            const sortedOptions = questionWithOpenEndedChoice.choices.sort()
            const sortedShuffledOptions = shuffledOptions.sort()

            expect(sortedOptions).toEqual(sortedShuffledOptions)
        })
    })

    describe('branching logic', () => {
        const survey: Survey = {
            name: 'My survey',
            description: '',
            type: SurveyType.Popover,
            questions: [] as SurveyQuestion[],
            start_date: new Date().toISOString(),
            end_date: null,
        } as Survey

        // Simple branching
        it('when no branching specified, should return the index of the next question or `end`', () => {
            survey.questions = [
                { type: SurveyQuestionType.Open, question: 'Question A' },
                { type: SurveyQuestionType.Open, question: 'Question B' },
            ] as SurveyQuestion[]
            expect(surveys.getNextSurveyStep(survey, 0, 'Some response')).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 1, 'Some response')).toEqual(SurveyQuestionBranchingType.End)
        })

        it('should branch out to `end`', () => {
            survey.questions = [
                {
                    type: SurveyQuestionType.Open,
                    question: 'Question A',
                    branching: { type: SurveyQuestionBranchingType.End },
                },
                { type: SurveyQuestionType.Open, question: 'Question B' },
            ] as SurveyQuestion[]
            expect(surveys.getNextSurveyStep(survey, 0, 'Some response')).toEqual(SurveyQuestionBranchingType.End)
        })

        it('should branch out to a specific question', () => {
            survey.questions = [
                {
                    type: SurveyQuestionType.Open,
                    question: 'Question A',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
                },
                { type: SurveyQuestionType.Open, question: 'Question B' },
                { type: SurveyQuestionType.Open, question: 'Question C' },
            ] as SurveyQuestion[]
            expect(surveys.getNextSurveyStep(survey, 0, 'Some response')).toEqual(2)
        })

        // Single-choice
        it('should branch out correctly based on a single choice response, with shuffled choices', () => {
            survey.questions = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    question: 'Will you leave us a review?',
                    choices: ['Yes', 'No', 'Maybe'],
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { 0: 1, 1: 2, 2: 3 },
                    },
                    shuffleOptions: true,
                },
                { type: SurveyQuestionType.Open, question: 'Why yes?' },
                { type: SurveyQuestionType.Open, question: 'Why no?' },
                { type: SurveyQuestionType.Open, question: 'Why maybe?' },
            ] as unknown[] as SurveyQuestion[]
            expect(surveys.getNextSurveyStep(survey, 0, 'Yes')).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 'No')).toEqual(2)
            expect(surveys.getNextSurveyStep(survey, 0, 'Maybe')).toEqual(3)
        })

        // Response-based branching, scale 1-3
        it('should branch out the negative/neutral/positive respondends correctly (scale 1-3)', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 3,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown[] as SurveyQuestion[]

            expect(surveys.getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 2)).toEqual(2)
            expect(surveys.getNextSurveyStep(survey, 0, 3)).toEqual(3)
        })

        // Response-based branching, scale 1-5
        it('should branch out the negative/neutral/positive respondents correctly (scale 1-5)', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 5,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown as SurveyQuestion[]

            expect(surveys.getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 3)).toEqual(2)
            expect(surveys.getNextSurveyStep(survey, 0, 5)).toEqual(3)
        })

        // Response-based branching, scale 1-7
        it('should branch out the negative/neutral/positive respondents correctly (scale 1-7)', () => {
            survey.questions = [
                {
                    question: 'How satisfied are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 7,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'We apologize for your experience. Can you tell us more?' },
                { type: SurveyQuestionType.Open, question: 'What could we do to improve your experience?' },
                { type: SurveyQuestionType.Open, question: 'Great! What did you enjoy the most?' },
            ] as unknown as SurveyQuestion[]

            expect(surveys.getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 2)).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 3)).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 4)).toEqual(2)
            expect(surveys.getNextSurveyStep(survey, 0, 5)).toEqual(3)
            expect(surveys.getNextSurveyStep(survey, 0, 6)).toEqual(3)
            expect(surveys.getNextSurveyStep(survey, 0, 7)).toEqual(3)
        })

        // Response-based branching, scale 0-10 (NPS)
        it('should branch out detractors/passives/promoters correctly', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 10,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { detractors: 1, passives: 2, promoters: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown as SurveyQuestion[]

            expect(surveys.getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(surveys.getNextSurveyStep(survey, 0, 8)).toEqual(2)
            expect(surveys.getNextSurveyStep(survey, 0, 10)).toEqual(3)
        })

        it('should display questions in the order AGCEHDFB', () => {
            survey.questions = [
                {
                    type: SurveyQuestionType.Open,
                    question: 'A',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 6 },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'B',
                    branching: { type: SurveyQuestionBranchingType.End },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'C',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 4 },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'D',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 5 },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'E',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 7 },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'F',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 1 },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'G',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'H',
                    branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 3 },
                },
            ] as SurveyQuestion[]

            const desiredOrder = ['A', 'G', 'C', 'E', 'H', 'D', 'F', 'B']
            let currentStep = 0
            const actualOrder: string[] = []

            for (let i = 0; i < survey.questions.length; i++) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = surveys.getNextSurveyStep(survey, currentStep, 'Some response')
            }

            expect(desiredOrder).toEqual(actualOrder)
            expect(currentStep).toEqual(SurveyQuestionBranchingType.End)
        })

        it('should display questions in the correct order in a multi-step NPS survey', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 10,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { detractors: 1, passives: 2, promoters: 3 },
                    },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'Sorry to hear that. Please enter your email, a colleague will be in touch.',
                    branching: { type: SurveyQuestionBranchingType.End },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'Seems you are not completely happy. Tell us more!',
                    branching: { type: SurveyQuestionBranchingType.End },
                },
                {
                    type: SurveyQuestionType.SingleChoice,
                    question: 'Glad to hear that! Will you leave us a review?',
                    choices: ['Yes', 'No'],
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { 0: 4, 1: 5 },
                    },
                },
                {
                    type: SurveyQuestionType.Link,
                    question: 'Great! Here is the link:',
                    branching: { type: SurveyQuestionBranchingType.End },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'Curious, why not?',
                },
            ] as SurveyQuestion[]

            // Detractor customer
            let desiredOrder = [
                'How happy are you?',
                'Sorry to hear that. Please enter your email, a colleague will be in touch.',
            ]
            let actualOrder: string[] = []
            let currentStep = 0
            let answers: (string | number | null)[] = [0, 'test@test.com']
            for (const answer of answers) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = surveys.getNextSurveyStep(survey, currentStep, answer)
            }
            expect(desiredOrder).toEqual(actualOrder)
            expect(currentStep).toEqual(SurveyQuestionBranchingType.End)

            // Passive customer
            desiredOrder = ['How happy are you?', 'Seems you are not completely happy. Tell us more!']
            actualOrder = []
            currentStep = 0
            answers = [7, 'I am not impressed']
            for (const answer of answers) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = surveys.getNextSurveyStep(survey, currentStep, answer)
            }
            expect(desiredOrder).toEqual(actualOrder)
            expect(currentStep).toEqual(SurveyQuestionBranchingType.End)

            // Promoter customer, won't leave a review
            desiredOrder = ['How happy are you?', 'Glad to hear that! Will you leave us a review?', 'Curious, why not?']
            actualOrder = []
            currentStep = 0
            answers = [10, 'No', 'I am lazy']
            for (const answer of answers) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = surveys.getNextSurveyStep(survey, currentStep, answer)
            }
            expect(desiredOrder).toEqual(actualOrder)
            expect(currentStep).toEqual(SurveyQuestionBranchingType.End)

            // Promoter customer, will leave a review
            desiredOrder = [
                'How happy are you?',
                'Glad to hear that! Will you leave us a review?',
                'Great! Here is the link:',
            ]
            actualOrder = []
            currentStep = 0
            answers = [10, 'Yes', null]
            for (const answer of answers) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = surveys.getNextSurveyStep(survey, currentStep, answer)
            }
            expect(desiredOrder).toEqual(actualOrder)
            expect(currentStep).toEqual(SurveyQuestionBranchingType.End)
        })

        it('should throw an error for an invalid scale', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 2,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown as SurveyQuestion[]
            expect(() => surveys.getNextSurveyStep(survey, 0, 1)).toThrow('The scale must be one of: 3, 5, 7, 10')
        })

        it('should throw an error for a response value out of the valid range', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 3,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown as SurveyQuestion[]
            expect(() => surveys.getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 1-3')
            ;(survey.questions[0] as RatingSurveyQuestion).scale = 5
            expect(() => surveys.getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 1-5')
            ;(survey.questions[0] as RatingSurveyQuestion).scale = 7
            expect(() => surveys.getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 1-7')
            ;(survey.questions[0] as RatingSurveyQuestion).scale = 10
            expect(() => surveys.getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 0-10')
        })

        it('should throw an error for if a response value in a rating question is not an integer', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 3,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown as SurveyQuestion[]
            expect(() => surveys.getNextSurveyStep(survey, 0, '2')).toThrow('The response type must be an integer')
            expect(() => surveys.getNextSurveyStep(survey, 0, 'some_string')).toThrow(
                'The response type must be an integer'
            )
        })
    })
})
