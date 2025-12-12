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
import { CaptureResult, PostHogConfig, PropertyMatchType } from '../../types'
import { SurveyEventReceiver } from '../../utils/survey-event-receiver'
import { createMockPostHog, createMockConfig } from '../helpers/posthog-instance'

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
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })

            instance = createMockPostHog({
                config: config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
                getSurveys: jest.fn((callback) => callback(surveysWithEvents)),
            })
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

    describe('property filter based surveys', () => {
        let config: PostHogConfig
        let instance: PostHog
        let mockAddCaptureHook: jest.Mock

        const createEventPayload = (eventName: string, properties: Record<string, any> = {}): CaptureResult => ({
            $set: undefined,
            $set_once: undefined,
            event: eventName,
            timestamp: undefined,
            uuid: '0C984DA5-761F-4F75-9582-D2F95B43B04A',
            properties,
        })

        const createSurveyWithPropertyFilters = (
            id: string,
            eventName: string,
            propertyFilters: Record<string, { values: string[]; operator: PropertyMatchType }>
        ): Survey =>
            ({
                name: `${id} survey`,
                id,
                description: `${id} survey description`,
                type: SurveyType.Popover,
                questions: [{ type: SurveyQuestionType.Open, question: 'test question' }],
                conditions: {
                    events: {
                        values: [
                            {
                                name: eventName,
                                propertyFilters,
                            },
                        ],
                    },
                },
            }) as unknown as Survey

        beforeEach(() => {
            mockAddCaptureHook = jest.fn()
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })

            instance = createMockPostHog({
                config: config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
                getSurveys: jest.fn((callback) => callback([])),
            })
        })

        afterEach(() => {
            instance.persistence?.clear()
        })

        it('activates survey with exact property match', () => {
            const survey = createSurveyWithPropertyFilters('exact-test', 'purchase', {
                product_type: { values: ['premium'], operator: 'exact' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            // Set up getSurveys mock to return the survey
            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should match exact value
            registeredHook('purchase', createEventPayload('purchase', { product_type: 'premium' }))
            expect(surveyEventReceiver.getSurveys()).toContain('exact-test')
        })

        it('does not activate survey with non-matching exact property', () => {
            const survey = createSurveyWithPropertyFilters('exact-test', 'purchase', {
                product_type: { values: ['premium'], operator: 'exact' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should not match different value
            registeredHook('purchase', createEventPayload('purchase', { product_type: 'basic' }))
            expect(surveyEventReceiver.getSurveys()).not.toContain('exact-test')
        })

        it('activates survey with is_not property match', () => {
            const survey = createSurveyWithPropertyFilters('is-not-test', 'purchase', {
                product_type: { values: ['basic'], operator: 'is_not' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should match when value is not 'basic'
            registeredHook('purchase', createEventPayload('purchase', { product_type: 'premium' }))
            expect(surveyEventReceiver.getSurveys()).toContain('is-not-test')
        })

        it('activates survey with regex property match', () => {
            const survey = createSurveyWithPropertyFilters('regex-test', 'page_view', {
                url: { values: ['/app/.*'], operator: 'regex' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should match regex pattern
            registeredHook('page_view', createEventPayload('page_view', { url: '/app/dashboard' }))
            expect(surveyEventReceiver.getSurveys()).toContain('regex-test')
        })

        it('activates survey with icontains property match', () => {
            const survey = createSurveyWithPropertyFilters('icontains-test', 'search', {
                query: { values: ['PRODUCT'], operator: 'icontains' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should match case-insensitive contains
            registeredHook('search', createEventPayload('search', { query: 'new product features' }))
            expect(surveyEventReceiver.getSurveys()).toContain('icontains-test')
        })

        it('activates survey with multiple property filters (all must match)', () => {
            const survey = createSurveyWithPropertyFilters('multi-filter-test', 'purchase', {
                product_type: { values: ['premium'], operator: 'exact' },
                amount: { values: ['100'], operator: 'is_not' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should match when both conditions are met
            registeredHook('purchase', createEventPayload('purchase', { product_type: 'premium', amount: '200' }))
            expect(surveyEventReceiver.getSurveys()).toContain('multi-filter-test')

            // Clear previous activation
            surveyEventReceiver.getSurveys().length = 0

            // Should not match when one condition fails
            registeredHook('purchase', createEventPayload('purchase', { product_type: 'premium', amount: '100' }))
            expect(surveyEventReceiver.getSurveys()).not.toContain('multi-filter-test')
        })

        it('does not activate survey when required property is missing', () => {
            const survey = createSurveyWithPropertyFilters('missing-prop-test', 'purchase', {
                product_type: { values: ['premium'], operator: 'exact' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should not match when property is missing
            registeredHook('purchase', createEventPayload('purchase', { other_prop: 'value' }))
            expect(surveyEventReceiver.getSurveys()).not.toContain('missing-prop-test')
        })

        it('activates survey without property filters based on event name only', () => {
            const survey = createSurveyWithPropertyFilters('no-filters-test', 'purchase', {})

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as jest.Mock).mockImplementation((callback) => callback([survey]))

            // Should match based on event name only
            registeredHook('purchase', createEventPayload('purchase', { any_prop: 'any_value' }))
            expect(surveyEventReceiver.getSurveys()).toContain('no-filters-test')
        })
    })

    describe('action based surveys', () => {
        let config: PostHogConfig
        let instance: PostHog

        beforeEach(() => {
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })

            instance = createMockPostHog({
                config: config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: jest.fn(),
                getSurveys: jest.fn((callback) => callback([])),
            })
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

    describe('cancel events', () => {
        let config: PostHogConfig
        let instance: PostHog
        let mockAddCaptureHook: jest.Mock
        let mockCancelPendingSurvey: jest.Mock

        const surveyWithCancelEvent: Survey = {
            name: 'survey with cancel',
            id: 'survey-with-cancel',
            description: 'survey with cancel event',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'test?' }],
            appearance: { surveyPopupDelaySeconds: 5 },
            conditions: {
                events: { values: [{ name: 'trigger_event' }] },
                cancelEvents: { values: [{ name: 'cancel_event' }] },
            },
        } as unknown as Survey

        beforeEach(() => {
            mockAddCaptureHook = jest.fn()
            mockCancelPendingSurvey = jest.fn()
            config = createMockConfig({
                token: 'testtoken',
                api_host: 'https://app.posthog.com',
                persistence: 'memory',
            })

            instance = createMockPostHog({
                config: config,
                persistence: new PostHogPersistence(config),
                _addCaptureHook: mockAddCaptureHook,
                getSurveys: jest.fn((callback) => callback([surveyWithCancelEvent])),
                cancelPendingSurvey: mockCancelPendingSurvey,
            })
        })

        afterEach(() => {
            instance.persistence?.clear()
        })

        it('calls cancelPendingSurvey when cancel event fires', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([surveyWithCancelEvent])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            // Trigger the survey first
            registeredHook('trigger_event')
            expect(surveyEventReceiver.getSurveys()).toContain('survey-with-cancel')

            // Fire cancel event
            registeredHook('cancel_event')
            expect(mockCancelPendingSurvey).toHaveBeenCalledWith('survey-with-cancel')
        })

        it('removes cancelled survey from activated surveys', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([surveyWithCancelEvent])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            // Trigger then cancel
            registeredHook('trigger_event')
            expect(surveyEventReceiver.getSurveys()).toContain('survey-with-cancel')

            registeredHook('cancel_event')
            expect(surveyEventReceiver.getSurveys()).not.toContain('survey-with-cancel')
        })

        it('does not call cancelPendingSurvey for unrelated events', () => {
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([surveyWithCancelEvent])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            registeredHook('some_other_event')
            expect(mockCancelPendingSurvey).not.toHaveBeenCalled()
        })
    })
})
