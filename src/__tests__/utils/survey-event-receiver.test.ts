/// <reference lib="dom" />

import {
    SurveyType,
    SurveyQuestionType,
    Survey,
    SurveyActionType,
    ActionStepStringMatching,
} from '../../posthog-surveys-types'
import { PostHogPersistence } from '../../posthog-persistence'
import { PostHog } from '../../posthog-core'
import { CaptureResult, PostHogConfig } from '../../types'
import { SurveyEventReceiver } from '../../utils/survey-event-receiver'

describe('survey-event-receiver', () => {
    describe('event based surveys', () => {
        let config: PostHogConfig
        let instance: PostHog
        let mockAddCaptureHook: jest.Mock

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
            mockAddCaptureHook = jest.fn()
            config = {
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            } as unknown as PostHogConfig

            instance = {
                config: config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
            } as unknown as PostHog
        })

        afterEach(() => {
            instance.persistence?.clear()
        })

        it('register makes receiver listen for all surveys with events', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            const registry = surveyEventReceiver.getEventToSurveys()
            expect(registry.has('user_subscribed')).toBeTruthy()
            expect(registry.get('user_subscribed')).toEqual(['first-survey', 'third-survey'])

            expect(registry.has('address_changed')).toBeTruthy()
            expect(registry.get('address_changed')).toEqual(['third-survey'])
        })

        it('receiver activates survey on event', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]
            registeredHook('billing_changed')
            const activatedSurveys = surveyEventReceiver.getSurveys()
            expect(activatedSurveys).toContain('first-survey')
        })

        it('receiver removes survey from list after its shown', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            const firstSurvey = surveysWithEvents[0]
            if (firstSurvey.conditions && firstSurvey.conditions?.events) {
                firstSurvey.conditions.events.repeatedActivation = true
            }

            surveyEventReceiver.register(surveysWithEvents)
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]
            registeredHook('billing_changed')
            const activatedSurveys = surveyEventReceiver.getSurveys()
            expect(activatedSurveys).toContain('first-survey')

            registeredHook('survey shown', {
                $set: undefined,
                $set_once: undefined,
                event: 'survey shown',
                timestamp: undefined,
                uuid: '',
                properties: {
                    $survey_id: 'first-survey',
                },
            })

            expect(surveyEventReceiver.getSurveys()).toEqual([])
        })

        it('receiver activates same survey on multiple event', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]
            registeredHook('billing_changed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
            registeredHook('billing_removed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        it('receiver activates multiple surveys on same event', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]
            registeredHook('user_subscribed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey', 'third-survey'])
        })

        it('receiver activates multiple surveys on different events', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]
            registeredHook('billing_changed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
            registeredHook('address_changed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey', 'third-survey'])
        })
    })

    describe('action based surveys', () => {
        let config: PostHogConfig
        let instance: PostHog

        beforeEach(() => {
            config = {
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            } as unknown as PostHogConfig

            instance = {
                config: config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: jest.fn(),
            } as unknown as PostHog
        })

        afterEach(() => {
            instance.persistence?.clear()
        })

        const createCaptureResult = (eventName: string, currentUrl?: string): CaptureResult => {
            return {
                $set: undefined,
                $set_once: undefined,
                properties: {
                    $current_url: currentUrl,
                },
                timestamp: undefined,
                uuid: '0C984DA5-761F-4F75-9582-D2F95B43B04A',
                event: eventName,
            }
        }
        const createAction = (
            id: number,
            eventName: string,
            currentUrl?: string,
            urlMatch?: ActionStepStringMatching
        ): SurveyActionType => {
            return {
                id: id,
                name: `${eventName || 'user defined '} action`,
                steps: [
                    {
                        event: eventName,
                        text: null,
                        text_matching: null,
                        href: null,
                        href_matching: null,
                        url: currentUrl,
                        url_matching: urlMatch || 'exact',
                    },
                ],
                created_at: '2024-06-20T14:39:23.616676Z',
                deleted: false,
                is_action: true,
                tags: [],
            }
        }

        const autoCaptureSurvey = {
            name: 'first survey',
            id: 'first-survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
            conditions: {
                actions: [createAction(2, '$autocapture') as unknown as SurveyActionType],
            },
        } as unknown as Survey

        const pageViewSurvey = {
            name: 'pageview survey',
            id: 'pageview-survey',
            description: 'pageview survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
            conditions: {
                actions: [createAction(3, '$pageview') as unknown as SurveyActionType],
            },
        } as unknown as Survey

        it('can match action on event name', () => {
            const myPageViewSurvey = {
                name: 'my pageview survey',
                id: 'my-pageview-survey',
                description: 'pageview survey description',
                type: SurveyType.Popover,
                questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
                conditions: {
                    actions: {
                        values: [createAction(3, '$mypageview') as unknown as SurveyActionType],
                    },
                },
            } as unknown as Survey
            autoCaptureSurvey.conditions.actions.values = [createAction(2, '$match_event_name')]
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, myPageViewSurvey])
            surveyEventReceiver._getActionMatcher().on('$match_event_name', createCaptureResult('$match_event_name'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])

            surveyEventReceiver
                ._getActionMatcher()
                .on('$mypageview', createCaptureResult(myPageViewSurvey.conditions.actions.values[0].steps[0].event))
            expect(surveyEventReceiver.getSurveys()).toContain('my-pageview-survey')
        })

        it('can match action on current_url exact', () => {
            autoCaptureSurvey.conditions.actions.values = [createAction(2, '$autocapture', 'https://us.posthog.com')]
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver
                ._getActionMatcher()
                .on('$autocapture', createCaptureResult('$autocapture', 'https://eu.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).not.toEqual(['first-survey'])
            surveyEventReceiver
                ._getActionMatcher()
                .on('$autocapture', createCaptureResult('$autocapture', 'https://us.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        it('can match action on current_url regexp', () => {
            autoCaptureSurvey.conditions.actions.values = [
                createAction(2, '$current_url_regexp', '[a-z][a-z].posthog.*', 'regex'),
            ]
            let surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver
                ._getActionMatcher()
                .on('$autocapture', createCaptureResult('$current_url_regexp', 'https://eu.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])

            surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver
                ._getActionMatcher()
                .on('$autocapture', createCaptureResult('$autocapture', 'https://us.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        it('can match action on html element selector', () => {
            const action = createAction(2, '$autocapture')
            action.steps[0].selector = '* > #__next .flex > button:nth-child(2)'
            autoCaptureSurvey.conditions.actions.values = [action]
            const result = createCaptureResult('$autocapture', 'https://eu.posthog.com')
            result.properties.$element_selectors = ['* > #__next .flex > button:nth-child(2)']
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver._getActionMatcher().on('$autocapture', result)
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })
    })
})
