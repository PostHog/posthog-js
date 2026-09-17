import './helpers/surveys-setup'
import type { Mock } from 'vitest'
import { createSurveyTriggerHost } from './helpers/survey-trigger-host'
import type { SurveyTriggerHost } from '../src/survey-event-receiver'
/// <reference lib="dom" />

import { SurveyType, SurveyQuestionType } from '../src/survey-constants'
import type { Survey, SurveyActionType, ActionStepStringMatching } from '../src/types/surveys'
import type { PropertyOperator } from '@posthog/core'
import type { SurveyCapturedEvent as CaptureResult } from '../src/survey-event-host'
import { SurveyEventReceiver } from '../src/survey-event-receiver'

describe('survey-event-receiver', () => {
    describe('event based surveys', () => {
        let instance: SurveyTriggerHost
        let mockAddCaptureHook: Mock

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
            mockAddCaptureHook = vi.fn()

            instance = createSurveyTriggerHost({
                subscribeCapture: mockAddCaptureHook,
                getSurveys: vi.fn((callback) => callback(surveysWithEvents)),
            })
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

        it('reuses and disposes its capture hook idempotently', () => {
            const unsubscribe = vi.fn()
            mockAddCaptureHook.mockReturnValue(unsubscribe)
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register(surveysWithEvents)
            surveyEventReceiver.register(surveysWithEvents)

            surveyEventReceiver.dispose()
            surveyEventReceiver.dispose()

            expect(mockAddCaptureHook).toHaveBeenCalledTimes(1)
            expect(unsubscribe).toHaveBeenCalledTimes(1)
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
                event: 'survey shown',
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
        let instance: SurveyTriggerHost
        let mockAddCaptureHook: Mock

        const createEventPayload = (eventName: string, properties: Record<string, any> = {}): CaptureResult => ({
            event: eventName,
            properties,
        })

        const createSurveyWithPropertyFilters = (
            id: string,
            eventName: string,
            propertyFilters: Record<string, { values: string[]; operator: PropertyOperator }>
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
            mockAddCaptureHook = vi.fn()

            instance = createSurveyTriggerHost({
                subscribeCapture: mockAddCaptureHook,
                getSurveys: vi.fn((callback) => callback([])),
            })
        })

        it('activates survey with exact property match', () => {
            const survey = createSurveyWithPropertyFilters('exact-test', 'purchase', {
                product_type: { values: ['premium'], operator: 'exact' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            // Set up getSurveys mock to return the survey
            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

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

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

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

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

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

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

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

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

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

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

            // Should match when both conditions are met
            registeredHook('purchase', createEventPayload('purchase', { product_type: 'premium', amount: '200' }))
            expect(surveyEventReceiver.getSurveys()).toContain('multi-filter-test')

            // A fresh receiver (e.g. after a reload) starts with no in-memory activations
            const freshReceiver = new SurveyEventReceiver(instance)
            freshReceiver.register([survey])
            const freshHook = mockAddCaptureHook.mock.calls.at(-1)?.[0]

            // Should not match when one condition fails (amount is_not 100 fails)
            freshHook('purchase', createEventPayload('purchase', { product_type: 'premium', amount: '100' }))
            expect(freshReceiver.getSurveys()).not.toContain('multi-filter-test')
        })

        it('does not activate survey when required property is missing', () => {
            const survey = createSurveyWithPropertyFilters('missing-prop-test', 'purchase', {
                product_type: { values: ['premium'], operator: 'exact' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

            // Should not match when property is missing
            registeredHook('purchase', createEventPayload('purchase', { other_prop: 'value' }))
            expect(surveyEventReceiver.getSurveys()).not.toContain('missing-prop-test')
        })

        it('activates survey without property filters based on event name only', () => {
            const survey = createSurveyWithPropertyFilters('no-filters-test', 'purchase', {})

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

            // Should match based on event name only
            registeredHook('purchase', createEventPayload('purchase', { any_prop: 'any_value' }))
            expect(surveyEventReceiver.getSurveys()).toContain('no-filters-test')
        })

        it('activates survey with gt (greater than) numeric property match', () => {
            const survey = createSurveyWithPropertyFilters('gt-test', 'purchase', {
                amount: { values: ['100'], operator: 'gt' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

            registeredHook('purchase', createEventPayload('purchase', { amount: 150 }))
            expect(surveyEventReceiver.getSurveys()).toContain('gt-test')
        })

        it('activates survey with lt (less than) numeric property match', () => {
            const survey = createSurveyWithPropertyFilters('lt-test', 'purchase', {
                amount: { values: ['100'], operator: 'lt' },
            })

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([survey]))

            registeredHook('purchase', createEventPayload('purchase', { amount: 50 }))
            expect(surveyEventReceiver.getSurveys()).toContain('lt-test')
        })
    })

    describe('action based surveys', () => {
        let instance: SurveyTriggerHost

        beforeEach(() => {
            instance = createSurveyTriggerHost({
                subscribeCapture: vi.fn(),
                getSurveys: vi.fn((callback) => callback([])),
            })
        })

        const createCaptureResult = (eventName: string, currentUrl?: string): CaptureResult => {
            return {
                properties: {
                    $current_url: currentUrl,
                },
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

        it('replaces action definitions when surveys are refreshed', () => {
            const survey = {
                ...autoCaptureSurvey,
                conditions: { actions: { values: [createAction(2, '$old_action')] } },
            } as unknown as Survey
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            surveyEventReceiver.replace([
                {
                    ...survey,
                    conditions: { actions: { values: [createAction(2, '$new_action')] } },
                } as unknown as Survey,
            ])

            surveyEventReceiver._getActionMatcher().on('$old_action', createCaptureResult('$old_action'))
            expect(surveyEventReceiver.getSurveys()).not.toContain(survey.id)

            surveyEventReceiver._getActionMatcher().on('$new_action', createCaptureResult('$new_action'))
            expect(surveyEventReceiver.getSurveys()).toContain(survey.id)
        })

        it('clears trigger definitions when refreshed surveys have no triggers', () => {
            const survey = {
                ...autoCaptureSurvey,
                conditions: {
                    events: { values: [{ name: '$old_event' }] },
                    actions: { values: [createAction(2, '$old_action')] },
                },
            } as unknown as Survey
            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([survey])
            expect(surveyEventReceiver.getEventToSurveys().has('$old_event')).toBe(true)

            surveyEventReceiver.replace([])
            expect(surveyEventReceiver.getEventToSurveys().size).toBe(0)

            surveyEventReceiver._getActionMatcher().on('$old_action', createCaptureResult('$old_action'))
            expect(surveyEventReceiver.getSurveys()).not.toContain(survey.id)
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
                .on('$autocapture', createCaptureResult('$current_url_regexp', 'https://us.posthog.com'))
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
        let instance: SurveyTriggerHost
        let mockAddCaptureHook: Mock
        let mockCancelPendingSurvey: Mock

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
            mockAddCaptureHook = vi.fn()
            mockCancelPendingSurvey = vi.fn()

            instance = createSurveyTriggerHost({
                subscribeCapture: mockAddCaptureHook,
                getSurveys: vi.fn((callback) => callback([surveyWithCancelEvent])),
                cancelSurvey: mockCancelPendingSurvey,
            })
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

        it('cancels survey when cancel event property filter matches', () => {
            const surveyWithCancelPropertyFilter: Survey = {
                ...surveyWithCancelEvent,
                id: 'survey-cancel-prop-filter',
                conditions: {
                    events: { values: [{ name: 'trigger_event' }] },
                    cancelEvents: {
                        values: [
                            {
                                name: 'cancel_event',
                                propertyFilters: {
                                    reason: { values: ['user_navigated_away'], operator: 'exact' },
                                },
                            },
                        ],
                    },
                },
            } as unknown as Survey

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([surveyWithCancelPropertyFilter]))

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([surveyWithCancelPropertyFilter])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            registeredHook('trigger_event')
            expect(surveyEventReceiver.getSurveys()).toContain('survey-cancel-prop-filter')

            registeredHook('cancel_event', {
                event: 'cancel_event',
                properties: { reason: 'user_navigated_away' },
            } as CaptureResult)

            expect(mockCancelPendingSurvey).toHaveBeenCalledWith('survey-cancel-prop-filter')
            expect(surveyEventReceiver.getSurveys()).not.toContain('survey-cancel-prop-filter')
        })

        it('does not cancel survey when cancel event property filter does not match', () => {
            const surveyWithCancelPropertyFilter: Survey = {
                ...surveyWithCancelEvent,
                id: 'survey-cancel-prop-filter',
                conditions: {
                    events: { values: [{ name: 'trigger_event' }] },
                    cancelEvents: {
                        values: [
                            {
                                name: 'cancel_event',
                                propertyFilters: {
                                    reason: { values: ['user_navigated_away'], operator: 'exact' },
                                },
                            },
                        ],
                    },
                },
            } as unknown as Survey

            ;(instance.getSurveys as Mock).mockImplementation((callback) => callback([surveyWithCancelPropertyFilter]))

            const surveyEventReceiver = new SurveyEventReceiver(instance)
            surveyEventReceiver.register([surveyWithCancelPropertyFilter])
            const registeredHook = mockAddCaptureHook.mock.calls[0][0]

            registeredHook('trigger_event')
            expect(surveyEventReceiver.getSurveys()).toContain('survey-cancel-prop-filter')

            registeredHook('cancel_event', {
                event: 'cancel_event',
                properties: { reason: 'some_other_reason' },
            } as CaptureResult)

            expect(mockCancelPendingSurvey).not.toHaveBeenCalled()
            expect(surveyEventReceiver.getSurveys()).toContain('survey-cancel-prop-filter')
        })
    })
})
