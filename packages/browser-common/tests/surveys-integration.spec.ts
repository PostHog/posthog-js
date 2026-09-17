/* oxlint-disable compat/compat -- Tests run in Node. */
// @vitest-environment jsdom
import './helpers/surveys-setup'
import type { Mock } from 'vitest'
import type { JSDOM } from 'jsdom'
declare const jsdom: JSDOM
/// <reference lib="dom" />

import { expect, it, describe, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { SURVEYS } from '../src/surveys-config'
import { generateSurveys, getNextSurveyStep, SurveyManager } from '../src/surveys-renderer'
import {
    getDisplayOrderChoices,
    getDisplayOrderQuestions,
    getSurveyContainerClass,
} from '../src/surveys/surveys-extension-utils'
import { PostHogSurveys } from '../src/surveys'
import { TestClient } from './helpers/test-client'
import { createSurveysRuntimeHost } from './helpers/surveys-runtime-host'
import type { MockSurveysRuntimeHost } from './helpers/surveys-runtime-host'
import type { SurveysConfig } from '../src/surveys-config'
import { createSurveyTriggerHost } from './helpers/survey-trigger-host'
import { SurveyQuestionBranchingType, SurveyQuestionType, SurveySchedule, SurveyType } from '../src/survey-constants'
import type { MultipleSurveyQuestion, RatingSurveyQuestion, Survey, SurveyQuestion } from '../src/types/surveys'
import type { RemoteConfig } from '../src/types/remote-config'
import * as globals from '../src/utils/globals'
import { window } from '../src/utils/globals'
import { window as assignableWindow } from '../src/utils/globals'
import { SurveyEventReceiver } from '../src/survey-event-receiver'
import { SURVEY_LOGGER as logger } from '../src/utils/survey-utils'

describe('surveys', () => {
    let config: SurveysConfig
    let client: TestClient
    let host: MockSurveysRuntimeHost
    let surveys: PostHogSurveys
    let surveysResponse: { status?: number; surveys?: Survey[] }
    const originalWindowLocation = assignableWindow.location.href
    const getSurveys = (forceReload = false): Promise<Survey[]> =>
        new Promise((resolve) => surveys.getSurveys(resolve, forceReload))

    const flagsResponse = {
        featureFlags: {
            'linked-flag-key': true,
            'survey-targeting-flag-key': true,
            'linked-flag-key2': true,
            'survey-targeting-flag-key2': false,
            'enabled-internal-targeting-flag-key': true,
            'disabled-internal-targeting-flag-key': false,
            'survey-targeting-835605292e': true,
            'survey-targeting-b3276efeb6-custom': true,
        },
        surveys: true,
    }

    const firstSurveys: Survey[] = [
        {
            id: 'first-survey',
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            start_date: new Date().toISOString(),
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
            start_date: new Date().toISOString(),
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
            start_date: new Date().toISOString(),
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a moblin?' }],
        } as unknown as Survey,
        {
            name: 'third survey',
            id: 'third-survey',
            description: 'third survey description',
            type: SurveyType.Popover,
            start_date: new Date().toISOString(),
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

    const surveysWithFeatureFlagKeys: Survey[] = [
        {
            name: 'survey with feature flags',
            id: 'survey-with-flags',
            description: 'survey with feature flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what do you think?' }],
            feature_flag_keys: [
                { key: 'flag1', value: 'linked-flag-key' },
                { key: 'flag2', value: 'survey-targeting-flag-key' },
            ],
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey,
        {
            name: 'survey with disabled feature flags',
            id: 'survey-with-disabled-flags',
            description: 'survey with disabled feature flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'why not?' }],
            feature_flag_keys: [
                { key: 'flag1', value: 'linked-flag-key2' },
                { key: 'flag2', value: 'survey-targeting-flag-key2' },
            ],
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey,
        {
            name: 'survey without feature flags',
            id: 'survey-without-flags',
            description: 'survey without feature flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'any thoughts?' }],
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey,
    ]

    beforeEach(() => {
        surveysResponse = { surveys: firstSurveys }
        client = new TestClient()
        vi.spyOn(client, 'sendRequest').mockImplementation(async () => ({ statusCode: 200, json: surveysResponse }))
        config = { disableSurveys: false, cookielessMode: false, advancedEnableSurveys: false, requestTimeoutMs: 10000 }
        host = createSurveysRuntimeHost({
            hasLoadedFlags: true,
            getFlag: vi.fn((key) => flagsResponse.featureFlags[key]),
            isFlagEnabled: vi.fn((key) => flagsResponse.featureFlags[key]),
            getCachedSurveys: () => client.kv.get(SURVEYS),
            getSurveys: (callback, forceReload) => surveys.getSurveys(callback, forceReload),
        })
        const createReceiver = () => new SurveyEventReceiver(createSurveyTriggerHost({ kv: client.kv }))
        surveys = new PostHogSurveys({
            get: () => config,
            getExtensions: () => undefined,
            createEventReceiver: createReceiver,
        })
        surveys.setup(client)
        surveys.loadIfEnabled = vi.fn(() => {
            surveys._surveyEventReceiver = createReceiver()
            host.eventReceiver = surveys._surveyEventReceiver
        })
        ;(surveys as any)._surveyManager = new SurveyManager(host)
        jsdom.reconfigure({ url: 'https://example.com' })
    })

    afterEach(() => {
        surveys.dispose()
        jsdom.reconfigure({ url: originalWindowLocation })
    })

    it('disposes automatic display polling and visibility handling', () => {
        host.getSurveys = vi.fn((callback) => callback([]))
        const removeEventListener = vi.spyOn(document, 'removeEventListener')
        const surveyManager = generateSurveys(host, true)

        surveyManager?.dispose()
        surveyManager?.dispose()

        expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
        removeEventListener.mockRestore()
    })

    it('removes rendered survey DOM after a force reload replaces the persisted definitions', () => {
        const survey = firstSurveys[0]
        const surveyManager = new SurveyManager(host)
        surveyManager.handlePopoverSurvey(survey)
        expect(document.querySelector(getSurveyContainerClass(survey, true))).not.toBeNull()

        client.kv.set({ [SURVEYS]: secondSurveys })
        surveyManager.dispose()

        expect(document.querySelector(getSurveyContainerClass(survey, true))).toBeNull()
    })

    it('does not retain caller-owned inline survey targets for disposal', () => {
        const survey = firstSurveys[0]
        const target = document.createElement('div')
        document.body.appendChild(target)
        const surveyManager = new SurveyManager(host)

        act(() => surveyManager.renderSurvey(survey, target))

        expect(target.childElementCount).toBeGreaterThan(0)
        expect(surveyManager['_renderedTargets'].size).toBe(0)

        act(() => render(null, target))
        target.remove()
    })

    it('unmounts surveys rendered through the public popover helper on dispose', () => {
        const survey = firstSurveys[0]
        const removeEventListener = vi.spyOn(window, 'removeEventListener')
        const surveyManager = new SurveyManager(host)

        act(() => surveyManager.renderPopover(survey))
        expect(document.querySelector(getSurveyContainerClass(survey, true))).not.toBeNull()

        act(() => surveyManager.dispose())

        expect(document.querySelector(getSurveyContainerClass(survey, true))).toBeNull()
        expect(removeEventListener).toHaveBeenCalledWith('PHSurveyClosed', expect.any(Function))
        removeEventListener.mockRestore()
    })

    it('posthog.reset() removes surveys tracking properties from storage', () => {
        localStorage.setItem('seenSurvey_XYZ', '1')
        localStorage.setItem('seenSurvey_ABC', '1')
        localStorage.setItem('lastSeenSurveyDate', 'some date here')
        surveys.reset()
        expect(localStorage.getItem('lastSeenSurveyDate')).toBeNull()
        expect(localStorage.getItem('seenSurvey_XYZ')).toBeNull()
        expect(localStorage.getItem('seenSurvey_ABC')).toBeNull()
    })

    it('getSurveys registers the survey event receiver if a survey has events', async () => {
        surveysResponse = { surveys: surveysWithEvents }
        surveys.loadIfEnabled()
        expect(await getSurveys(true)).toEqual(surveysWithEvents)

        const registry = (surveys._surveyEventReceiver as SurveyEventReceiver)?.getEventToSurveys()
        expect(registry.has('user_subscribed')).toBeTruthy()
        expect(registry.get('user_subscribed')).toEqual(['first-survey', 'third-survey'])

        expect(registry.has('address_changed')).toBeTruthy()
        expect(registry.get('address_changed')).toEqual(['third-survey'])
    })

    it('getSurveys returns empty array if surveys are undefined', async () => {
        surveysResponse = { status: 0 }
        expect(await getSurveys()).toEqual([])
    })

    it('getSurveys returns empty array if surveys are disabled', () => {
        config.disableSurveys = true
        surveys.getSurveys((data) => {
            expect(data).toEqual([])
        })
        expect(client.sendRequest).not.toHaveBeenCalled()
    })

    it('can render survey async', async () => {
        const result = await surveys.canRenderSurveyAsync(firstSurveys[0].id, true)

        expect(result.disabledReason).toBeUndefined()
        expect(result.visible).toBeTruthy()
    })

    it('cannot render survey async', async () => {
        const result = await surveys.canRenderSurveyAsync('i dont exist', true)

        expect(result.visible).toBeFalsy()
    })

    describe('getActiveMatchingSurveys', () => {
        beforeEach(() => {
            surveys.getSurveys = vi.fn((callback) => callback(client.kv.get(SURVEYS) ?? surveysResponse.surveys ?? []))
        })

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
        const surveyWithMobileDeviceType: Survey = {
            name: 'survey with device type',
            description: 'survey with device type description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with device type?' }],
            conditions: { deviceTypes: ['Android', 'iOS', 'Mobile'], deviceTypesMatchType: 'icontains' },
            start_date: new Date().toISOString(),
            end_date: null,
        } as unknown as Survey
        const surveyWithWebDeviceType: Survey = {
            name: 'survey with device type',
            description: 'survey with device type description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with device type?' }],
            conditions: { deviceTypes: ['Web'], deviceTypesMatchType: 'icontains' },
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

        const apiSurveyWithCachedTargetingFlags: Survey = {
            id: 'api-survey-with-cached-targeting-flags',
            name: 'API survey with cached targeting flags',
            type: SurveyType.API,
            schedule: SurveySchedule.Once,
            start_date: new Date().toISOString(),
            end_date: null,
            targeting_flag_key: 'survey-targeting-835605292e',
            internal_targeting_flag_key: 'survey-targeting-b3276efeb6-custom',
            questions: [
                {
                    type: SurveyQuestionType.Rating,
                    question: 'How satisfied are you?',
                    display: 'number',
                    scale: 5,
                    lowerBoundLabel: 'Not satisfied',
                    upperBoundLabel: 'Very satisfied',
                },
            ],
        } as unknown as Survey

        // Waiting for flags before trusting the internal targeting flag is only safe for
        // iteration-based surveys, whose stored seen key rolls over. Applying it to a `once`
        // survey with a cached enabled flag denies eligibility for the whole pre-flags window,
        // and API surveys never get a second evaluation to recover on.
        const deferredBeforeFlagsLoad = {
            eligible: false,
            reason: 'Feature flags have not loaded yet; deferring internal targeting flag check',
        }

        it.each([
            { schedule: SurveySchedule.Once, currentIteration: null, expected: { eligible: true } },
            { schedule: SurveySchedule.Once, currentIteration: 0, expected: { eligible: true } },
            { schedule: SurveySchedule.Once, currentIteration: 1, expected: deferredBeforeFlagsLoad },
            { schedule: SurveySchedule.Recurring, currentIteration: null, expected: deferredBeforeFlagsLoad },
            { schedule: SurveySchedule.Recurring, currentIteration: 2, expected: deferredBeforeFlagsLoad },
        ])(
            'checks a $schedule survey on iteration $currentIteration against a cached internal targeting flag before flags load',
            ({ schedule, currentIteration, expected }) => {
                host.hasLoadedFlags = false
                const surveyManager = (surveys as any)._surveyManager as SurveyManager

                expect(
                    surveyManager.checkSurveyEligibility({
                        ...apiSurveyWithCachedTargetingFlags,
                        schedule,
                        current_iteration: currentIteration,
                    } as Survey)
                ).toEqual(expected)
            }
        )

        // A caller that asks once gets exactly one answer, so a `once` survey wrongly deferred here
        // is lost for that page rather than delayed. Both rows share one fixture and one call, which
        // keeps the result attributable to the flag-loading state.
        it.each([
            { state: 'have not loaded', hasLoadedFlags: false },
            { state: 'have loaded', hasLoadedFlags: true },
        ])('returns a cached-eligible API survey to a one-shot caller when flags $state', ({ hasLoadedFlags }) => {
            host.hasLoadedFlags = hasLoadedFlags
            client.kv.set({ $surveys: [apiSurveyWithCachedTargetingFlags] })
            const callback = vi.fn()

            surveys.getActiveMatchingSurveys(callback)

            expect(callback).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith([apiSurveyWithCachedTargetingFlags])
        })

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
            jsdom.reconfigure({ url: 'https://posthog.com' })
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithUrl])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            document.body.appendChild(document.createElement('div')).className = 'test-selector'
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithSelector])
            })
            const testSelectorEl = document!.querySelector('.test-selector')
            if (testSelectorEl) {
                document.body.removeChild(testSelectorEl)
            }

            jsdom.reconfigure({ url: 'https://posthogapp.com' })
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

            const originalWindowLocation = assignableWindow.location.href

            jsdom.reconfigure({ url: 'https://regex-url.com/test' })
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithRegexUrl])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            jsdom.reconfigure({ url: 'https://example.com?name=something' })
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithParamRegexUrl])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            jsdom.reconfigure({ url: 'https://app.subdomain.com' })
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithWildcardSubdomainUrl])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            jsdom.reconfigure({ url: 'https://wildcard.com/something/other' })
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithWildcardRouteUrl])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            jsdom.reconfigure({ url: 'https://example.com/exact' })
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithExactUrlMatch])
            })
            jsdom.reconfigure({ url: originalWindowLocation })
        })

        it('returns surveys based on device types matching', () => {
            surveysResponse = {
                surveys: [surveyWithMobileDeviceType],
            }

            const userAgent =
                'Mozilla/5.0 (Linux; U; Android-4.0.3; en-us; Galaxy Nexus Build/IML74K) AppleWebKit/535.7 (KHTML, like Gecko) CrMo/16.0.912.75 Mobile Safari/535.7'
            const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)

            // matching
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithMobileDeviceType])
            })
            userAgentSpy.mockRestore()
        })

        it('returns surveys based on device types not matching', () => {
            surveysResponse = {
                surveys: [surveyWithWebDeviceType],
            }

            const userAgent =
                'Mozilla/5.0 (Linux; U; Android-4.0.3; en-us; Galaxy Nexus Build/IML74K) AppleWebKit/535.7 (KHTML, like Gecko) CrMo/16.0.912.75 Mobile Safari/535.7'
            const userAgentSpy = vi.spyOn(globals, 'userAgent', 'get').mockReturnValue(userAgent)

            // matching
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([])
            })
            userAgentSpy.mockRestore()
        })

        it('returns surveys based on exclusion conditions', () => {
            surveysResponse = {
                surveys: [surveyWithUrlDoesNotContain, surveyWithIsNotUrlMatch, surveyWithUrlDoesNotContainRegex],
            }

            jsdom.reconfigure({ url: 'https://posthog.com' })
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithIsNotUrlMatch and surveyWithUrlDoesNotContainRegex because they don't contain posthog.com
                expect(data).toEqual([surveyWithIsNotUrlMatch, surveyWithUrlDoesNotContainRegex])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            jsdom.reconfigure({ url: 'https://example.com/exact' })
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithUrlDoesNotContain and surveyWithUrlDoesNotContainRegex because they are not exact matches
                expect(data).toEqual([surveyWithUrlDoesNotContain, surveyWithUrlDoesNotContainRegex])
            })
            jsdom.reconfigure({ url: originalWindowLocation })

            jsdom.reconfigure({ url: 'https://regex-url.com/test' })
            surveys.getActiveMatchingSurveys((data) => {
                // returns surveyWithUrlDoesNotContain and surveyWithIsNotUrlMatch because they are not regex matches
                expect(data).toEqual([surveyWithUrlDoesNotContain, surveyWithIsNotUrlMatch])
            })
            jsdom.reconfigure({ url: originalWindowLocation })
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
            jsdom.reconfigure({ url: 'https://posthogapp.com' })
            document.body.appendChild(document.createElement('div')).className = 'test-selector'
            surveysResponse = { surveys: [activeSurvey, surveyWithSelector, surveyWithEverything] }
            // activeSurvey returns because there are no restrictions on conditions or flags on it
            surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([activeSurvey, surveyWithSelector, surveyWithEverything])
            })
        })

        it('returns only surveys with enabled feature flags', () => {
            surveysResponse = { surveys: surveysWithFeatureFlagKeys }

            surveys.getActiveMatchingSurveys((data) => {
                // Should include:
                // - survey with enabled flags (survey-with-flags)
                // - survey without flags (survey-without-flags)
                // Should NOT include:
                // - survey with disabled flags (survey-with-disabled-flags)
                expect(data.length).toBe(2)
                expect(data.map((s) => s.id)).toContain('survey-with-flags')
                expect(data.map((s) => s.id)).toContain('survey-without-flags')
                expect(data.map((s) => s.id)).not.toContain('survey-with-disabled-flags')
            })
        })
    })

    describe('renderSurvey', () => {
        const inAppSurvey: Survey = {
            id: 'in-app-survey',
            name: 'In-app survey',
            description: 'Survey that can be rendered in app',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'What do you think?' }],
            start_date: new Date().toISOString(),
            end_date: null,
        } as Survey

        const externalSurvey: Survey = {
            id: 'external-survey',
            name: 'External survey',
            description: 'Survey that should be rendered externally',
            type: SurveyType.ExternalSurvey,
            questions: [{ type: SurveyQuestionType.Open, question: 'What do you think?' }],
            start_date: new Date().toISOString(),
            end_date: null,
        } as Survey

        beforeEach(() => {
            // Create a div element to render surveys into
            const testDiv = document.createElement('div')
            testDiv.id = 'test-survey-container'
            document.body.appendChild(testDiv)
        })

        afterEach(() => {
            // Clean up the test div
            const testDiv = document.getElementById('test-survey-container')
            if (testDiv) {
                document.body.removeChild(testDiv)
            }
        })

        it('should render in-app surveys (popover, widget, api)', () => {
            client.kv.set({ [SURVEYS]: [inAppSurvey] })
            const mockRenderSurvey = vi.fn()
            ;(surveys as any)._surveyManager = { renderSurvey: mockRenderSurvey }
            const loggerWarnSpy = vi.spyOn(logger, 'warn')

            surveys.renderSurvey('in-app-survey', '#test-survey-container')

            expect(mockRenderSurvey).toHaveBeenCalledWith(
                inAppSurvey,
                document.querySelector('#test-survey-container'),
                undefined
            )
            expect(loggerWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('cannot be rendered in the app'))
        })

        it('should not render external surveys and show warning', () => {
            client.kv.set({ [SURVEYS]: [externalSurvey] })
            const mockRenderSurvey = vi.fn()
            ;(surveys as any)._surveyManager = { renderSurvey: mockRenderSurvey }
            const loggerWarnSpy = vi.spyOn(logger, 'warn')

            surveys.renderSurvey('external-survey', '#test-survey-container')

            expect(mockRenderSurvey).not.toHaveBeenCalled()
            expect(loggerWarnSpy).toHaveBeenCalledWith('Surveys of type external_survey cannot be rendered in the app')
        })

        it('should warn when survey manager is not initialized', () => {
            ;(surveys as any)._surveyManager = null
            const loggerWarnSpy = vi.spyOn(logger, 'warn')

            surveys.renderSurvey('test-survey', '#test-survey-container')

            expect(loggerWarnSpy).toHaveBeenCalledWith('init was not called')
        })

        it('should warn when survey is not found', () => {
            client.kv.set({ [SURVEYS]: [] })
            ;(surveys as any)._surveyManager = { renderSurvey: vi.fn() }
            const loggerWarnSpy = vi.spyOn(logger, 'warn')

            surveys.renderSurvey('non-existent-survey', '#test-survey-container')

            expect(loggerWarnSpy).toHaveBeenCalledWith('Survey not found')
        })

        it('should warn when target element is not found', () => {
            client.kv.set({ [SURVEYS]: [inAppSurvey] })
            ;(surveys as any)._surveyManager = { renderSurvey: vi.fn() }
            const loggerWarnSpy = vi.spyOn(logger, 'warn')

            surveys.renderSurvey('in-app-survey', '#non-existent-element')

            expect(loggerWarnSpy).toHaveBeenCalledWith('Survey element not found')
        })
    })

    describe('_isSurveyFeatureFlagEnabled', () => {
        let surveyManager: SurveyManager

        beforeEach(() => {
            surveys.loadIfEnabled()
            surveyManager = (surveys as any)._surveyManager
        })

        it('returns true when flagKey is null', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled(null)
            expect(result).toBe(true)
        })

        it('returns true when flagKey is undefined', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled(undefined)
            expect(result).toBe(true)
        })

        it('returns true when flagKey is empty string', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('')
            expect(result).toBe(true)
        })

        it('returns true when regular feature flag is enabled', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('linked-flag-key')
            expect(result).toBe(true)
            // Verify that isFeatureEnabled was called with send_event: true for regular flags
            expect(host.isFlagEnabled).toHaveBeenCalledWith('linked-flag-key', {
                send_event: true,
            })
        })

        it('returns false when regular feature flag is disabled', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('survey-targeting-flag-key2')
            expect(result).toBe(false)
            expect(host.isFlagEnabled).toHaveBeenCalledWith('survey-targeting-flag-key2', {
                send_event: false,
            })
        })

        it('returns true when survey targeting flag is enabled', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('survey-targeting-flag-key')
            expect(result).toBe(true)
            // Verify that isFeatureEnabled was called with send_event: false for survey targeting flags
            expect(host.isFlagEnabled).toHaveBeenCalledWith('survey-targeting-flag-key', {
                send_event: false,
            })
        })

        it('returns false when survey targeting flag is disabled', () => {
            const result = surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('survey-targeting-disabled-flag')
            expect(result).toBe(false)
            expect(host.isFlagEnabled).toHaveBeenCalledWith('survey-targeting-disabled-flag', {
                send_event: false,
            })
        })

        it('sets send_event to false for flags starting with survey-targeting- prefix', () => {
            surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('survey-targeting-some-test-flag')
            expect(host.isFlagEnabled).toHaveBeenCalledWith('survey-targeting-some-test-flag', {
                send_event: false,
            })
        })

        it('sets send_event to true for flags not starting with survey-targeting- prefix', () => {
            surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('regular-feature-flag')
            expect(host.isFlagEnabled).toHaveBeenCalledWith('regular-feature-flag', {
                send_event: true,
            })
        })

        it('handles flags with survey-targeting- anywhere but not at start correctly', () => {
            surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('my-survey-targeting-flag')
            expect(host.isFlagEnabled).toHaveBeenCalledWith('my-survey-targeting-flag', {
                send_event: true,
            })
        })

        it('correctly converts truthy/falsy flag values to boolean', () => {
            // Mock different return values
            const mockIsFeatureEnabled = vi.fn()
            host.isFlagEnabled = mockIsFeatureEnabled

            // Test truthy values
            mockIsFeatureEnabled.mockReturnValue('true')
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(true)

            mockIsFeatureEnabled.mockReturnValue(1)
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(true)

            mockIsFeatureEnabled.mockReturnValue({})
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(true)

            // Test falsy values
            mockIsFeatureEnabled.mockReturnValue(false)
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(false)

            mockIsFeatureEnabled.mockReturnValue(0)
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(false)

            mockIsFeatureEnabled.mockReturnValue('')
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(false)

            mockIsFeatureEnabled.mockReturnValue(null)
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(false)

            mockIsFeatureEnabled.mockReturnValue(undefined)
            expect(surveyManager.getTestAPI().isSurveyFeatureFlagEnabled('test-flag')).toBe(false)
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
                { type: SurveyQuestionType.Open, question: 'Question A', id: 'question-a' },
                { type: SurveyQuestionType.Open, question: 'Question B', id: 'question-b' },
                { type: SurveyQuestionType.Open, question: 'Question C', id: 'question-c' },
                { type: SurveyQuestionType.Open, question: 'Question D', id: 'question-d' },
                { type: SurveyQuestionType.Open, question: 'Question E', id: 'question-e' },
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

        it('shuffles questions with Fisher-Yates without mutating configured order', () => {
            const random = vi.spyOn(Math, 'random').mockReturnValue(0)
            const questions = [...surveyWithShufflingQuestions.questions]
            try {
                expect(getDisplayOrderQuestions(surveyWithShufflingQuestions)).toEqual([
                    ...questions.slice(1),
                    questions[0],
                ])
                expect(surveyWithShufflingQuestions.questions).toEqual(questions)
            } finally {
                random.mockRestore()
            }
        })

        const inProgress = (questionOrder?: string[]) =>
            ({ surveySubmissionId: 'sub', responses: {}, lastQuestionIndex: 0, questionOrder }) as any

        it('should restore the recorded question order for a survey already in progress', () => {
            const order = surveyWithShufflingQuestions.questions.map((q) => q.id).reverse() as string[]

            expect(getDisplayOrderQuestions(surveyWithShufflingQuestions, inProgress(order)).map((q) => q.id)).toEqual(
                order
            )
        })

        it('should use the configured order for state persisted without a question order', () => {
            expect(getDisplayOrderQuestions(surveyWithShufflingQuestions, inProgress())).toEqual(
                surveyWithShufflingQuestions.questions
            )
        })

        it('should use the configured order when a recorded question is no longer in the survey', () => {
            const ids = surveyWithShufflingQuestions.questions.map((q) => q.id) as string[]
            const orderWithRemovedQuestion = [...ids.slice(0, -1), 'removed-question-id']

            expect(
                getDisplayOrderQuestions(surveyWithShufflingQuestions, inProgress(orderWithRemovedQuestion)).map(
                    (q) => q.id
                )
            ).toEqual(ids)
        })

        it('should use the configured order when the recorded order covers only some of the questions', () => {
            const ids = surveyWithShufflingQuestions.questions.map((q) => q.id) as string[]

            expect(
                getDisplayOrderQuestions(surveyWithShufflingQuestions, inProgress(ids.slice(0, -1))).map((q) => q.id)
            ).toEqual(ids)
        })

        it('should not shuffle questions if any question has branching', () => {
            const surveyWithBranching = {
                ...surveyWithShufflingQuestions,
                questions: surveyWithShufflingQuestions.questions.map((question, index) =>
                    index === 1 ? { ...question, branching: { type: SurveyQuestionBranchingType.End } } : question
                ),
            } as unknown as Survey

            expect(getDisplayOrderQuestions(surveyWithBranching)).toEqual(surveyWithBranching.questions)
        })

        it('should shuffle questions when branching is present but has no type', () => {
            const surveyWithEmptyBranching = {
                ...surveyWithShufflingQuestions,
                questions: surveyWithShufflingQuestions.questions.map((question) => ({ ...question, branching: {} })),
            } as unknown as Survey

            expect(getDisplayOrderQuestions(surveyWithEmptyBranching)).not.toEqual(surveyWithEmptyBranching.questions)
        })

        it('should be able to find the original question from its ID', () => {
            const shuffledQuestions = getDisplayOrderQuestions(surveyWithShufflingQuestions)
            for (let i = 0; i < shuffledQuestions.length; i++) {
                const originalQuestion = surveyWithShufflingQuestions.questions.find(
                    (q) => q.id === shuffledQuestions[i].id
                )
                expect(shuffledQuestions[i].question).toEqual(originalQuestion?.question)
            }
        })

        it('shuffles frozen choices without mutation and keeps Other last', () => {
            const question = {
                ...questionWithOpenEndedChoice,
                choices: Object.freeze(['A', 'B', 'Other']) as unknown as string[],
            }
            expect(getDisplayOrderChoices(question)).toEqual(['B', 'A', 'Other'])
            expect(getDisplayOrderChoices(question)).toEqual(['B', 'A', 'Other'])
            expect(question.choices).toEqual(['A', 'B', 'Other'])
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

        it('shuffles frozen choices without mutation and keeps Other last', () => {
            const question = {
                ...questionWithOpenEndedChoice,
                choices: Object.freeze(['A', 'B', 'Other']) as unknown as string[],
            }
            expect(getDisplayOrderChoices(question)).toEqual(['B', 'A', 'Other'])
            expect(getDisplayOrderChoices(question)).toEqual(['B', 'A', 'Other'])
            expect(question.choices).toEqual(['A', 'B', 'Other'])
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
            expect(getNextSurveyStep(survey, 0, 'Some response')).toEqual(1)
            expect(getNextSurveyStep(survey, 1, 'Some response')).toEqual(SurveyQuestionBranchingType.End)
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
            expect(getNextSurveyStep(survey, 0, 'Some response')).toEqual(SurveyQuestionBranchingType.End)
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
            expect(getNextSurveyStep(survey, 0, 'Some response')).toEqual(2)
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
            expect(getNextSurveyStep(survey, 0, 'Yes')).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 'No')).toEqual(2)
            expect(getNextSurveyStep(survey, 0, 'Maybe')).toEqual(3)
        })

        it('should branch out correctly based on a single choice response, with an open ended choice', () => {
            survey.questions = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    question: 'Will you leave us a review?',
                    choices: ['Yes', 'No', 'Maybe', 'Sometimes', 'Other'],
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: {
                            '0': 'end',
                            '1': 1,
                            '4': 'end',
                        },
                    },
                    hasOpenChoice: true,
                },
                { type: SurveyQuestionType.Open, question: 'Why yes?' },
                { type: SurveyQuestionType.Open, question: 'Why no?' },
                { type: SurveyQuestionType.Open, question: 'Why maybe?' },
            ] as unknown[] as SurveyQuestion[]
            expect(getNextSurveyStep(survey, 0, 'Yes')).toEqual('end')
            expect(getNextSurveyStep(survey, 0, 'No')).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 'Maybe')).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 'this is another answer')).toEqual('end')
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

            expect(getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 2)).toEqual(2)
            expect(getNextSurveyStep(survey, 0, 3)).toEqual(3)
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

            expect(getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 3)).toEqual(2)
            expect(getNextSurveyStep(survey, 0, 5)).toEqual(3)
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

            expect(getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 2)).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 3)).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 4)).toEqual(2)
            expect(getNextSurveyStep(survey, 0, 5)).toEqual(3)
            expect(getNextSurveyStep(survey, 0, 6)).toEqual(3)
            expect(getNextSurveyStep(survey, 0, 7)).toEqual(3)
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

            expect(getNextSurveyStep(survey, 0, 1)).toEqual(1)
            expect(getNextSurveyStep(survey, 0, 8)).toEqual(2)
            expect(getNextSurveyStep(survey, 0, 10)).toEqual(3)
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
            let currentStep: number | typeof SurveyQuestionBranchingType.End = 0
            const actualOrder: string[] = []

            for (let i = 0; i < survey.questions.length; i++) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = getNextSurveyStep(survey, currentStep as number, 'Some response')
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
            let currentStep: number | typeof SurveyQuestionBranchingType.End = 0
            let answers: (string | number | null)[] = [0, 'test@test.com']
            for (const answer of answers) {
                const currentQuestion = survey.questions[currentStep]
                actualOrder.push(currentQuestion.question)
                currentStep = getNextSurveyStep(survey, currentStep as number, answer)
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
                currentStep = getNextSurveyStep(survey, currentStep as number, answer)
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
                currentStep = getNextSurveyStep(survey, currentStep as number, answer)
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
                currentStep = getNextSurveyStep(survey, currentStep as number, answer)
            }
            expect(desiredOrder).toEqual(actualOrder)
            expect(currentStep).toEqual(SurveyQuestionBranchingType.End)
        })

        it('should throw an error for an invalid scale', () => {
            survey.questions = [
                {
                    question: 'How happy are you?',
                    type: SurveyQuestionType.Rating,
                    scale: 4,
                    branching: {
                        type: SurveyQuestionBranchingType.ResponseBased,
                        responseValues: { negative: 1, neutral: 2, positive: 3 },
                    },
                },
                { type: SurveyQuestionType.Open, question: 'Sorry to hear that. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Seems you are not completely happy. Tell us more!' },
                { type: SurveyQuestionType.Open, question: 'Glad to hear that. Tell us more!' },
            ] as unknown as SurveyQuestion[]
            expect(() => getNextSurveyStep(survey, 0, 1)).toThrow('The scale must be one of: 2, 3, 5, 7, 10')
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
            expect(() => getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 1-3')
            ;(survey.questions[0] as RatingSurveyQuestion).scale = 5
            expect(() => getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 1-5')
            ;(survey.questions[0] as RatingSurveyQuestion).scale = 7
            expect(() => getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 1-7')
            ;(survey.questions[0] as RatingSurveyQuestion).scale = 10
            expect(() => getNextSurveyStep(survey, 0, 20)).toThrow('The response must be in range 0-10')
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
            expect(() => getNextSurveyStep(survey, 0, '2')).toThrow('The response type must be an integer')
            expect(() => getNextSurveyStep(survey, 0, 'some_string')).toThrow('The response type must be an integer')
        })
    })

    describe('is enabled', () => {
        it('starts effectively disabled', () => {
            expect(surveys['_isSurveysEnabled']).toBe(undefined)
        })

        it('is disabled by having no results in onRemoteConfig', () => {
            surveys.onRemoteConfig({
                ok: true,
                config: {
                    surveys: [],
                } as Partial<RemoteConfig> as RemoteConfig,
            })
            expect(surveys['_isSurveysEnabled']).toBe(false)
        })

        it('is enabled by having results in onRemoteConfig', () => {
            expect(surveys['_isSurveysEnabled']).toBe(undefined)
            surveys.onRemoteConfig({
                ok: true,
                config: {
                    surveys: ['example' as unknown as Survey],
                } as Partial<RemoteConfig> as RemoteConfig,
            })
            expect(surveys['_isSurveysEnabled']).toBe(true)
        })

        it('can be disabled by config despite results of onRemoteConfig', () => {
            config.disableSurveys = true
            surveys.onRemoteConfig({
                ok: true,
                config: {
                    surveys: ['example' as unknown as Survey],
                } as Partial<RemoteConfig> as RemoteConfig,
            })
            expect(surveys['_isSurveysEnabled']).toBe(undefined)
        })
    })

    describe('prefill initial responses', () => {
        const singleChoiceSurvey = (overrides: Partial<Survey>): Survey =>
            ({
                id: 'prefill-gate-survey',
                name: 'Prefill gate survey',
                type: SurveyType.Popover,
                questions: [
                    { type: SurveyQuestionType.SingleChoice, question: 'Q1', id: 'q1', choices: ['yes', 'no'] },
                    { type: SurveyQuestionType.SingleChoice, question: 'Q2', id: 'q2', choices: ['yes', 'no'] },
                ],
                current_iteration: null,
                current_iteration_start_date: null,
                ...overrides,
            }) as unknown as Survey

        beforeEach(() => {
            ;(host.capture as Mock).mockClear()
        })

        it('does not send a survey sent event for an incomplete prefill when partial responses are off', () => {
            const surveyManager = (surveys as any)._surveyManager
            const survey = singleChoiceSurvey({ enable_partial_responses: false })

            const completed = surveyManager._handleInitialResponses(survey, { 0: 0 })

            expect(completed).toBe(false)
            expect(host.capture).not.toHaveBeenCalledWith('survey sent', expect.anything())
        })

        it('sends a partial survey sent event when partial responses are on and the prefill auto-submits', () => {
            const surveyManager = (surveys as any)._surveyManager
            const survey = singleChoiceSurvey({
                enable_partial_responses: true,
                questions: [
                    {
                        type: SurveyQuestionType.SingleChoice,
                        question: 'Q1',
                        id: 'q1',
                        choices: ['yes', 'no'],
                        skipSubmitButton: true,
                    },
                    { type: SurveyQuestionType.SingleChoice, question: 'Q2', id: 'q2', choices: ['yes', 'no'] },
                ],
            } as Partial<Survey>)

            expect(surveyManager._handleInitialResponses(survey, { 0: 0, 1: 1 })).toBe(false)

            const [, properties] = (host.capture as Mock).mock.calls.find(([event]) => event === 'survey sent')
            expect(properties).toEqual(
                expect.objectContaining({ $survey_completed: false, $survey_response_q1: 'yes' })
            )
            expect(properties).not.toHaveProperty('$survey_response_q2')
        })

        it('does not send a partial event when the prefilled question does not auto-submit', () => {
            const surveyManager = (surveys as any)._surveyManager
            const survey = singleChoiceSurvey({ enable_partial_responses: true })

            expect(surveyManager._handleInitialResponses(survey, { 0: 0 })).toBe(false)
            expect(host.capture).not.toHaveBeenCalledWith('survey sent', expect.anything())
        })

        it('sends a completed survey sent event when the prefill answers every question', () => {
            const surveyManager = (surveys as any)._surveyManager
            const survey = singleChoiceSurvey({
                enable_partial_responses: false,
                questions: [
                    {
                        type: SurveyQuestionType.SingleChoice,
                        question: 'Q1',
                        id: 'q1',
                        choices: ['yes', 'no'],
                        skipSubmitButton: true,
                    },
                ],
            } as Partial<Survey>)

            const completed = surveyManager._handleInitialResponses(survey, { 0: 0 })

            expect(completed).toBe(true)
            expect(host.capture).toHaveBeenCalledWith(
                'survey sent',
                expect.objectContaining({ $survey_completed: true })
            )
        })
    })

    describe('language change re-translation', () => {
        let surveyManager: SurveyManager
        const frSurvey: Survey = {
            id: 'survey-lang-1',
            name: 'Lang Survey',
            type: SurveyType.Popover,
            questions: [
                {
                    type: SurveyQuestionType.Open,
                    question: 'Hello?',
                    id: 'q1',
                    description: '',
                    translations: { fr: { question: 'Bonjour?' } },
                },
            ],
            appearance: null,
            conditions: null,
            start_date: '2024-01-01T00:00:00Z',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
        } as unknown as Survey

        beforeEach(() => {
            surveyManager = (surveys as any)._surveyManager
            host.getCachedSurveys = vi.fn().mockReturnValue([frSurvey])
            host.onFlags = vi.fn().mockReturnValue(() => {})
        })

        it('updates _currentLanguage and re-renders when languagechange fires and language differs', () => {
            // Spy on _translateSurveyForRendering to return French translation
            ;(surveyManager as any)._translateSurveyForRendering = vi
                .fn()
                .mockReturnValue({ survey: frSurvey, language: 'fr' })
            ;(surveyManager as any)._surveyInFocus = frSurvey.id
            ;(surveyManager as any)._currentLanguage = 'en'
            ;(surveyManager as any)._surveyIsRendered = true

            window.dispatchEvent(new Event('languagechange'))

            expect((surveyManager as any)._currentLanguage).toBe('fr')
            expect((surveyManager as any)._translateSurveyForRendering).toHaveBeenCalledWith(frSurvey)
        })

        it('does not re-render when language is unchanged', () => {
            ;(surveyManager as any)._translateSurveyForRendering = vi
                .fn()
                .mockReturnValue({ survey: frSurvey, language: 'fr' })
            ;(surveyManager as any)._surveyInFocus = frSurvey.id
            ;(surveyManager as any)._currentLanguage = 'fr'
            ;(surveyManager as any)._surveyIsRendered = true

            const languageBefore = (surveyManager as any)._currentLanguage
            window.dispatchEvent(new Event('languagechange'))

            // _translateSurveyForRendering should still be called (to detect), but language shouldn't change
            expect((surveyManager as any)._currentLanguage).toBe(languageBefore)
        })

        it('does nothing when no survey is in focus', () => {
            const translateSpy = vi.fn()
            ;(surveyManager as any)._translateSurveyForRendering = translateSpy
            ;(surveyManager as any)._surveyInFocus = null

            window.dispatchEvent(new Event('languagechange'))

            expect(translateSpy).not.toHaveBeenCalled()
        })

        it('tracks the language flip but does not re-render while the survey is still pending delay', () => {
            // oxlint-disable-next-line typescript/no-require-imports
            const preactModule = require('preact')
            const renderSpy = vi.spyOn(preactModule, 'render')
            const translateSpy = vi.fn().mockReturnValue({ survey: frSurvey, language: 'fr' })
            ;(surveyManager as any)._translateSurveyForRendering = translateSpy

            // Survey is queued (focus set) but the delay timer has not fired yet
            ;(surveyManager as any)._surveyInFocus = frSurvey.id
            ;(surveyManager as any)._currentLanguage = 'en'
            ;(surveyManager as any)._surveyIsRendered = false

            window.dispatchEvent(new Event('languagechange'))

            // The language flip is still detected and tracked — renderAfterDelay reads
            // _currentLanguage fresh when the delay elapses, so this must stay accurate even
            // though nothing is on screen yet to actually re-render.
            expect(translateSpy).toHaveBeenCalledWith(frSurvey)
            expect((surveyManager as any)._currentLanguage).toBe('fr')
            expect(renderSpy).not.toHaveBeenCalled()

            renderSpy.mockRestore()
        })

        it('clears _currentLanguage when survey is removed from focus', () => {
            ;(surveyManager as any)._surveyInFocus = frSurvey.id
            ;(surveyManager as any)._currentLanguage = 'fr'

            surveyManager.getTestAPI().removeSurveyFromFocus(frSurvey as any)

            expect(surveyManager.getTestAPI().currentLanguage).toBeNull()
        })

        it('removes languagechange listener on dispose', () => {
            const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
            surveyManager.dispose()
            expect(removeListenerSpy).toHaveBeenCalledWith('languagechange', expect.any(Function))
        })
    })
})
