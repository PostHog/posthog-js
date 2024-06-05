/// <reference lib="dom" />

import { PostHogSurveys } from '../posthog-surveys'
import { SurveyType, SurveyQuestionType, Survey, MultipleSurveyQuestion } from '../posthog-surveys-types'
import { getDisplayOrderChoices, getDisplayOrderQuestions } from '../extensions/surveys/surveys-utils'
import { PostHogPersistence } from '../posthog-persistence'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig, Properties } from '../types'
import { window } from '../utils/globals'
import { RequestRouter } from '../utils/request-router'
import { assignableWindow } from '../utils/globals'
import { expectScriptToExist, expectScriptToNotExist } from './helpers/script-utils'

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

    beforeEach(() => {
        surveysResponse = { surveys: firstSurveys }

        config = {
            token: 'testtoken',
            api_host: 'https://app.posthog.com',
            persistence: 'memory',
        } as unknown as PostHogConfig

        instance = {
            config: config,
            persistence: new PostHogPersistence(config),
            requestRouter: new RequestRouter({ config } as any),
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

        surveys = new PostHogSurveys(instance)

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,
            // eslint-disable-next-line compat/compat
            value: new URL('https://example.com'),
        })
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
        const surveyWithUrlNotExact: Survey = {
            name: 'survey with url does not contain exact',
            description: 'survey with url does not contain exact description',
            type: SurveyType.Popover,
            questions: [
                { type: SurveyQuestionType.Open, question: 'what is a survey with url does not contain exact?' },
            ],
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
                surveys: [surveyWithUrlDoesNotContain, surveyWithUrlNotExact, surveyWithUrlDoesNotContainRegex],
            }

            // eslint-disable-next-line compat/compat
            assignableWindow.location = new URL('https://posthog.com') as unknown as Location
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithUrlNotExact and surveyWithUrlDoesNotContainRegex because they don't contain posthog.com
                expect(data).toEqual([surveyWithUrlNotExact, surveyWithUrlDoesNotContainRegex])
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
                // returns surveyWithUrlDoesNotContain and surveyWithUrlNotExact because they are not regex matches
                expect(data).toEqual([surveyWithUrlDoesNotContain, surveyWithUrlNotExact])
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
            for (let i = 0; i < shuffledQuestions.length; i++) {
                const originalQuestionIndex = shuffledQuestions[i].questionIndex
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

    describe('decide response', () => {
        beforeEach(() => {
            // clean the JSDOM to prevent interdependencies between tests
            document.body.innerHTML = ''
            document.head.innerHTML = ''
        })

        it('should not load when decide response says no', () => {
            surveys.afterDecideResponse({ surveys: false } as DecideResponse)
            // Make sure the script is not loaded
            expectScriptToNotExist('https://us-assets.i.posthog.com/static/surveys.js')
        })

        it('should load when decide response says so', () => {
            surveys.afterDecideResponse({ surveys: true } as DecideResponse)
            // Make sure the script is loaded
            expectScriptToExist('https://us-assets.i.posthog.com/static/surveys.js')
        })

        it('should not load when config says no', () => {
            config.disable_surveys = true
            surveys.afterDecideResponse({ surveys: true } as DecideResponse)
            // Make sure the script is not loaded
            expectScriptToNotExist('https://us-assets.i.posthog.com/static/surveys.js')
        })
    })
})
