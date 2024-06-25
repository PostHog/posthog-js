/// <reference lib="dom" />

import {
    SurveyType,
    SurveyQuestionType,
    Survey,
    ActionType,
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
            config = {
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            } as unknown as PostHogConfig

            instance = {
                config: config,
                persistence: new PostHogPersistence(config),
            } as unknown as PostHog
        })

        afterEach(() => {
            instance.persistence?.clear()
        })

        it('register makes receiver listen for all surveys with events', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            const registry = surveyEventReceiver.getEventRegistry()
            expect(registry.has('second-survey')).toBeFalsy()
            expect(registry.has('first-survey')).toBeTruthy()
            expect(registry.get('first-survey')).toEqual([
                'user_subscribed',
                'user_unsubscribed',
                'billing_changed',
                'billing_removed',
            ])

            expect(registry.has('third-survey')).toBeTruthy()
            expect(registry.get('third-survey')).toEqual(['user_subscribed', 'user_unsubscribed', 'address_changed'])
        })

        it('receiver activates survey on event', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            surveyEventReceiver.onEvent('billing_changed')
            const activatedSurveys = surveyEventReceiver.getSurveys()
            expect(activatedSurveys).toContain('first-survey')
        })

        it('receiver activates same survey on multiple event', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            surveyEventReceiver.onEvent('billing_changed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
            surveyEventReceiver.onEvent('billing_removed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        it('receiver activates multiple surveys on same event', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            surveyEventReceiver.onEvent('user_subscribed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey', 'third-survey'])
        })

        it('receiver activates multiple surveys on different events', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            surveyEventReceiver.onEvent('billing_changed')
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
            surveyEventReceiver.onEvent('address_changed')
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
        ): ActionType => {
            return {
                id: id,
                name: 'Ignored certain elements',
                description: '',
                post_to_slack: false,
                slack_message_format: '',
                steps: [
                    {
                        event: eventName,
                        properties: null,
                        selector: '* > #__next .ph-no-capture',
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
                is_calculating: false,
                last_calculated_at: '2024-06-20T14:39:23.616051Z',
                is_action: true,
                bytecode_error: null,
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
                actions: [createAction(2, '$autocapture') as unknown as ActionType],
            },
        } as unknown as Survey

        const pageViewSurvey = {
            name: 'pageview survey',
            id: 'pageview-survey',
            description: 'pageview survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
            conditions: {
                actions: [createAction(3, '$pageview') as unknown as ActionType],
            },
        } as unknown as Survey

        it('can match action on event name', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver.onEvent('$autocapture', createCaptureResult('$autocapture'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
            surveyEventReceiver.onEvent('$pageview', createCaptureResult('$pageview'))
            expect(surveyEventReceiver.getSurveys()).toContain('pageview-survey')
        })

        it('can match action on current_url exact', () => {
            autoCaptureSurvey.conditions.actions = [createAction(2, '$autocapture', 'https://us.posthog.com')]
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver.onEvent('$autocapture', createCaptureResult('$autocapture', 'https://eu.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).not.toEqual(['first-survey'])
            surveyEventReceiver.onEvent('$autocapture', createCaptureResult('$autocapture', 'https://us.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        it('can match action on current_url regexp', () => {
            autoCaptureSurvey.conditions.actions = [createAction(2, '$autocapture', '[a-z][a-z].posthog.*', 'regex')]
            let surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver.onEvent('$autocapture', createCaptureResult('$autocapture', 'https://eu.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])

            surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver.onEvent('$autocapture', createCaptureResult('$autocapture', 'https://us.posthog.com'))
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        it('can match action on html element selector', () => {
            const action = createAction(2, '$autocapture')
            action.steps[0].selector = '* > #__next .flex > button:nth-child(2)'
            autoCaptureSurvey.conditions.actions = [action]
            const result = createCaptureResult('$autocapture', 'https://eu.posthog.com')
            result.properties.$elements = [
                {
                    tag_name: 'button',
                    $el_text: 'Unsubscribe from newsletter',
                    nth_child: 3,
                    nth_of_type: 3,
                },
                {
                    tag_name: 'div',
                    classes: ['flex', 'items-center', 'gap-2', 'flex-wrap'],
                    attr__class: 'flex items-center gap-2 flex-wrap',
                    nth_child: 4,
                    nth_of_type: 2,
                },
                {
                    tag_name: 'main',
                    nth_child: 1,
                    nth_of_type: 1,
                },
                {
                    tag_name: 'div',
                    attr__id: '__next',
                    nth_child: 1,
                    nth_of_type: 1,
                },
                {
                    tag_name: 'body',
                    nth_child: 2,
                    nth_of_type: 1,
                },
            ]
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([autoCaptureSurvey, pageViewSurvey])
            surveyEventReceiver.onEvent('$autocapture', result)
            expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        })

        //
        // it('can match action with only element selector', () => {
        //     console.log(actionWithOnlySelector)
        // })
    })
})
