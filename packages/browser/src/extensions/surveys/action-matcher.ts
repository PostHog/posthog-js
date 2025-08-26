import { PostHog } from '../../posthog-core'
import { ActionStepStringMatching, ActionStepType, SurveyActionType, SurveyElement } from '../../posthog-surveys-types'
import { SimpleEventEmitter } from '../../utils/simple-event-emitter'
import { CaptureResult } from '../../types'
import { isUndefined } from '@posthog/core'
import { window } from '../../utils/globals'
import { isMatchingRegex } from '../../utils/regex-utils'

export class ActionMatcher {
    private readonly _actionRegistry?: Set<SurveyActionType>
    private readonly _instance?: PostHog
    private readonly _actionEvents: Set<string>
    private _debugEventEmitter = new SimpleEventEmitter()

    constructor(instance?: PostHog) {
        this._instance = instance
        this._actionEvents = new Set<string>()
        this._actionRegistry = new Set<SurveyActionType>()
    }

    init() {
        if (!isUndefined(this._instance?._addCaptureHook)) {
            const matchEventToAction = (eventName: string, eventPayload: any) => {
                this.on(eventName, eventPayload)
            }
            this._instance?._addCaptureHook(matchEventToAction)
        }
    }

    register(actions: SurveyActionType[]): void {
        if (isUndefined(this._instance?._addCaptureHook)) {
            return
        }

        actions.forEach((action) => {
            this._actionRegistry?.add(action)
            action.steps?.forEach((step) => {
                this._actionEvents?.add(step?.event || '')
            })
        })

        if (this._instance?.autocapture) {
            const selectorsToWatch: Set<string> = new Set<string>()
            actions.forEach((action) => {
                action.steps?.forEach((step) => {
                    if (step?.selector) {
                        selectorsToWatch.add(step?.selector)
                    }
                })
            })
            this._instance?.autocapture.setElementSelectors(selectorsToWatch)
        }
    }

    on(eventName: string, eventPayload?: CaptureResult) {
        if (eventPayload == null || eventName.length == 0) {
            return
        }

        if (!this._actionEvents.has(eventName) && !this._actionEvents.has(<string>eventPayload?.event)) {
            return
        }

        if (this._actionRegistry && this._actionRegistry?.size > 0) {
            this._actionRegistry.forEach((action) => {
                if (this._checkAction(eventPayload, action)) {
                    this._debugEventEmitter.emit('actionCaptured', action.name)
                }
            })
        }
    }

    _addActionHook(callback: (actionName: string, eventPayload?: any) => void): void {
        this.onAction('actionCaptured', (data) => callback(data))
    }

    private _checkAction(event?: CaptureResult, action?: SurveyActionType): boolean {
        if (action?.steps == null) {
            return false
        }

        for (const step of action.steps) {
            if (this._checkStep(event, step)) {
                return true
            }
        }

        return false
    }

    onAction(event: 'actionCaptured', cb: (...args: any[]) => void): () => void {
        return this._debugEventEmitter.on(event, cb)
    }

    private _checkStep = (event?: CaptureResult, step?: ActionStepType): boolean => {
        return (
            this._checkStepEvent(event, step) && this._checkStepUrl(event, step) && this._checkStepElement(event, step)
        )
    }

    private _checkStepEvent = (event?: CaptureResult, step?: ActionStepType): boolean => {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step?.event && event?.event !== step?.event) {
            return false // EVENT NAME IS A MISMATCH
        }
        return true
    }

    private _checkStepUrl(event?: CaptureResult, step?: ActionStepType): boolean {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step?.url) {
            const eventUrl = event?.properties?.$current_url
            if (!eventUrl || typeof eventUrl !== 'string') {
                return false // URL IS UNKNOWN
            }
            if (!ActionMatcher._matchString(eventUrl, step?.url, step?.url_matching || 'contains')) {
                return false // URL IS A MISMATCH
            }
        }
        return true
    }

    private static _matchString(url: string, pattern: string, matching: ActionStepStringMatching): boolean {
        switch (matching) {
            case 'regex':
                return !!window && isMatchingRegex(url, pattern)
            case 'exact':
                return pattern === url
            case 'contains':
                // Simulating SQL LIKE behavior (_ = any single character, % = any zero or more characters)
                // eslint-disable-next-line no-case-declarations
                const adjustedRegExpStringPattern = ActionMatcher._escapeStringRegexp(pattern)
                    .replace(/_/g, '.')
                    .replace(/%/g, '.*')
                return isMatchingRegex(url, adjustedRegExpStringPattern)

            default:
                return false
        }
    }

    private static _escapeStringRegexp(pattern: string): string {
        // Escape characters with special meaning either inside or outside character sets.
        // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
        return pattern.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
    }

    private _checkStepElement(event?: CaptureResult, step?: ActionStepType): boolean {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step?.href || step?.tag_name || step?.text) {
            const elements = this._getElementsList(event)
            if (
                !elements.some((element) => {
                    if (
                        step?.href &&
                        !ActionMatcher._matchString(element.href || '', step?.href, step?.href_matching || 'exact')
                    ) {
                        return false // ELEMENT HREF IS A MISMATCH
                    }
                    if (step?.tag_name && element.tag_name !== step?.tag_name) {
                        return false // ELEMENT TAG NAME IS A MISMATCH
                    }
                    if (
                        step?.text &&
                        !(
                            ActionMatcher._matchString(
                                element.text || '',
                                step?.text,
                                step?.text_matching || 'exact'
                            ) ||
                            ActionMatcher._matchString(
                                element.$el_text || '',
                                step?.text,
                                step?.text_matching || 'exact'
                            )
                        )
                    ) {
                        return false // ELEMENT TEXT IS A MISMATCH
                    }
                    return true
                })
            ) {
                // AT LEAST ONE ELEMENT MUST BE A SUBMATCH
                return false
            }
        }

        if (step?.selector) {
            const elementSelectors = event?.properties?.$element_selectors as unknown as string[]
            if (!elementSelectors) {
                return false // SELECTOR IS A MISMATCH
            }
            if (!elementSelectors.includes(step?.selector)) {
                return false // SELECTOR IS A MISMATCH
            }
        }

        return true
    }

    private _getElementsList(event?: CaptureResult): SurveyElement[] {
        if (event?.properties.$elements == null) {
            return []
        }

        return event?.properties.$elements as unknown as SurveyElement[]
    }
}
