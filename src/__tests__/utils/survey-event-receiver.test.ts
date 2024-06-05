/// <reference lib="dom" />

import { SurveyType, SurveyQuestionType, Survey } from '../../posthog-surveys-types'
import { PostHogPersistence } from '../../posthog-persistence'
import { PostHog } from '../../posthog-core'
import { PostHogConfig } from '../../types'
import { SurveyEventReceiver } from '../../utils/survey-event-receiver'

describe('survey-event-receiver', () => {
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
                events: ['user_subscribed', 'user_unsubscribed', 'billing_changed', 'billing_removed'],
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
                events: ['user_subscribed', 'user_unsubscribed', 'address_changed'],
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
        const surveyEventReceiver = new SurveyEventReceiver(instance.persistence)
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
        const surveyEventReceiver = new SurveyEventReceiver(instance.persistence)
        surveyEventReceiver.register(surveysWithEvents)
        surveyEventReceiver.on('billing_changed')
        const activatedSurveys = surveyEventReceiver.getSurveys()
        expect(activatedSurveys).toContain('first-survey')
    })

    it('receiver activates same survey on multiple event', () => {
        const surveyEventReceiver = new SurveyEventReceiver(instance.persistence)
        surveyEventReceiver.register(surveysWithEvents)
        surveyEventReceiver.on('billing_changed')
        expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        surveyEventReceiver.on('billing_removed')
        expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
    })

    it('receiver activates multiple surveys on same event', () => {
        const surveyEventReceiver = new SurveyEventReceiver(instance.persistence)
        surveyEventReceiver.register(surveysWithEvents)
        surveyEventReceiver.on('user_subscribed')
        expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey', 'third-survey'])
    })

    it('receiver activates multiple surveys on different events', () => {
        const surveyEventReceiver = new SurveyEventReceiver(instance.persistence)
        surveyEventReceiver.register(surveysWithEvents)
        surveyEventReceiver.on('billing_changed')
        expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey'])
        surveyEventReceiver.on('address_changed')
        expect(surveyEventReceiver.getSurveys()).toEqual(['first-survey', 'third-survey'])
    })
})
