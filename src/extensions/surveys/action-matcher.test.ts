/// <reference lib="dom" />

import { ActionType, ActionStepStringMatching } from '../../posthog-surveys-types'
import { PostHogPersistence } from '../../posthog-persistence'
import { PostHog } from '../../posthog-core'
import { CaptureResult, PostHogConfig } from '../../types'
import { ActionMatcher } from './action-matcher'

describe('action-matcher', () => {
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
    ): ActionType => {
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

    it('can match action on event name', () => {
        const pageViewAction = createAction(3, '$mypageview') as unknown as ActionType
        const actionMatcher = new ActionMatcher(instance)
        actionMatcher.register([pageViewAction])
        let pageViewActionMatched = false

        const onAction = (actionName: string) => {
            if (!pageViewActionMatched) {
                pageViewActionMatched = actionName === pageViewAction.name
            }
        }

        actionMatcher._addActionHook(onAction)

        actionMatcher.on('$match_event_name', createCaptureResult('$mypageview'))
        expect(pageViewActionMatched).toBeTruthy()
    })

    it('can match action on current_url exact', () => {
        const pageViewAction = createAction(2, '$autocapture', 'https://us.posthog.com')
        const actionMatcher = new ActionMatcher(instance)
        actionMatcher.register([pageViewAction])

        let pageViewActionMatched = false

        const onAction = (actionName: string) => {
            if (!pageViewActionMatched) {
                pageViewActionMatched = actionName === pageViewAction.name
            }
        }

        actionMatcher._addActionHook(onAction)
        actionMatcher.on('$autocapture', createCaptureResult('$autocapture', 'https://eu.posthog.com'))
        expect(pageViewActionMatched).toBeFalsy()

        actionMatcher.on('$autocapture', createCaptureResult('$autocapture', 'https://us.posthog.com'))
        expect(pageViewActionMatched).toBeTruthy()
    })

    it('can match action on current_url regexp', () => {
        const pageViewAction = createAction(2, '$current_url_regexp', '[a-z][a-z].posthog.*', 'regex')
        const actionMatcher = new ActionMatcher(instance)
        actionMatcher.register([pageViewAction])

        let pageViewActionMatched = false

        const onAction = (actionName: string) => {
            if (!pageViewActionMatched) {
                pageViewActionMatched = actionName === pageViewAction.name
            }
        }

        actionMatcher._addActionHook(onAction)
        actionMatcher.on('$autocapture', createCaptureResult('$current_url_regexp', 'https://eu.posthog.com'))
        expect(pageViewActionMatched).toBeTruthy()
        pageViewActionMatched = false

        actionMatcher.on('$autocapture', createCaptureResult('$current_url_regexp', 'https://us.posthog.com'))
        expect(pageViewActionMatched).toBeTruthy()
    })

    it('can match action on html element selector', () => {
        const buttonClickedAction = createAction(2, '$autocapture')
        if (buttonClickedAction.steps) {
            buttonClickedAction.steps[0].selector = '* > #__next .flex > button:nth-child(2)'
        }

        const actionMatcher = new ActionMatcher(instance)
        actionMatcher.register([buttonClickedAction])
        let buttonClickedActionMatched = false

        const onAction = (actionName: string) => {
            if (!buttonClickedActionMatched) {
                buttonClickedActionMatched = actionName === buttonClickedAction.name
            }
        }
        actionMatcher._addActionHook(onAction)

        const result = createCaptureResult('$autocapture', 'https://eu.posthog.com')
        result.properties.$element_selectors = []
        actionMatcher.on('$autocapture', result)
        expect(buttonClickedActionMatched).toBeFalsy()

        result.properties.$element_selectors = ['* > #__next .flex > button:nth-child(2)']

        actionMatcher.on('$autocapture', result)
        expect(buttonClickedActionMatched).toBeTruthy()
    })
})
