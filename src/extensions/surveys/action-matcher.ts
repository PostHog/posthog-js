import { PostHog } from '../../posthog-core'
import { ActionStepStringMatching, ActionStepType, SurveyActionType, SurveyElement } from '../../posthog-surveys-types'
import { SimpleEventEmitter } from '../../utils/simple-event-emitter'
import { CaptureResult } from '../../types'
import { isUndefined } from '../../utils/type-utils'
import { window } from '../../utils/globals'
import { isUrlMatchingRegex } from '../../utils/request-utils'

export class ActionMatcher {
    private readonly actionRegistry?: Set<SurveyActionType>
    private readonly instance?: PostHog
    private readonly actionEvents: Set<string>
    private _debugEventEmitter = new SimpleEventEmitter()

    constructor(instance?: PostHog) {
        this.instance = instance
        this.actionEvents = new Set<string>()
        this.actionRegistry = new Set<SurveyActionType>()
    }

    init() {
        if (!isUndefined(this.instance?._addCaptureHook)) {
            const matchEventToAction = (eventName: string, eventPayload: any) => {
                this.on(eventName, eventPayload)
            }
            this.instance?._addCaptureHook(matchEventToAction)
        }
    }

    register(actions: SurveyActionType[]): void {
        if (isUndefined(this.instance?._addCaptureHook)) {
            return
        }

        actions.forEach((action) => {
            this.actionRegistry?.add(action)
            action.steps?.forEach((step) => {
                this.actionEvents?.add(step?.event || '')
            })
        })

        if (this.instance?.autocapture) {
            const selectorsToWatch: Set<string> = new Set<string>()
            actions.forEach((action) => {
                action.steps?.forEach((step) => {
                    if (step?.selector) {
                        selectorsToWatch.add(step?.selector)
                    }
                })
            })
            this.instance?.autocapture.setElementSelectors(selectorsToWatch)
        }
    }

    on(eventName: string, eventPayload?: CaptureResult) {
        if (eventPayload == null || eventName.length == 0) {
            return
        }

        if (!this.actionEvents.has(eventName) && !this.actionEvents.has(<string>eventPayload?.event)) {
            return
        }

        if (this.actionRegistry && this.actionRegistry?.size > 0) {
            this.actionRegistry.forEach((action) => {
                if (this.checkAction(eventPayload, action)) {
                    this._debugEventEmitter.emit('actionCaptured', action.name)
                }
            })
        }
    }

    _addActionHook(callback: (actionName: string, eventPayload?: any) => void): void {
        this.onAction('actionCaptured', (data) => callback(data))
    }

    private checkAction(event?: CaptureResult, action?: SurveyActionType): boolean {
        if (action?.steps == null) {
            return false
        }

        for (const step of action.steps) {
            if (this.checkStep(event, step)) {
                return true
            }
        }

        return false
    }

    onAction(event: 'actionCaptured', cb: (...args: any[]) => void): () => void {
        return this._debugEventEmitter.on(event, cb)
    }

    private checkStep = (event?: CaptureResult, step?: ActionStepType): boolean => {
        return this.checkStepEvent(event, step) && this.checkStepUrl(event, step) && this.checkStepElement(event, step)
    }

    private checkStepEvent = (event?: CaptureResult, step?: ActionStepType): boolean => {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step?.event && event?.event !== step?.event) {
            return false // EVENT NAME IS A MISMATCH
        }
        return true
    }

    private checkStepUrl(event?: CaptureResult, step?: ActionStepType): boolean {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step?.url) {
            const eventUrl = event?.properties?.$current_url
            if (!eventUrl || typeof eventUrl !== 'string') {
                return false // URL IS UNKNOWN
            }
            if (!ActionMatcher.matchString(eventUrl, step?.url, step?.url_matching || 'contains')) {
                return false // URL IS A MISMATCH
            }
        }
        return true
    }

    private static matchString(url: string, pattern: string, matching: ActionStepStringMatching): boolean {
        switch (matching) {
            case 'regex':
                return !!window && isUrlMatchingRegex(url, pattern)
            case 'exact':
                return pattern === url
            case 'contains':
                // Simulating SQL LIKE behavior (_ = any single character, % = any zero or more characters)
                // eslint-disable-next-line no-case-declarations
                const adjustedRegExpStringPattern = ActionMatcher.escapeStringRegexp(pattern)
                    .replace(/_/g, '.')
                    .replace(/%/g, '.*')
                return isUrlMatchingRegex(url, adjustedRegExpStringPattern)

            default:
                return false
        }
    }

    private static escapeStringRegexp(pattern: string): string {
        // Escape characters with special meaning either inside or outside character sets.
        // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
        return pattern.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
    }

    private checkStepElement(event?: CaptureResult, step?: ActionStepType): boolean {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step?.href || step?.tag_name || step?.text) {
            const elements = this.getElementsList(event)
            if (
                !elements.some((element) => {
                    if (
                        step?.href &&
                        !ActionMatcher.matchString(element.href || '', step?.href, step?.href_matching || 'exact')
                    ) {
                        return false // ELEMENT HREF IS A MISMATCH
                    }
                    if (step?.tag_name && element.tag_name !== step?.tag_name) {
                        return false // ELEMENT TAG NAME IS A MISMATCH
                    }
                    if (
                        step?.text &&
                        !(
                            ActionMatcher.matchString(element.text || '', step?.text, step?.text_matching || 'exact') ||
                            ActionMatcher.matchString(
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

    private getElementsList(event?: CaptureResult): SurveyElement[] {
        if (event?.properties.$elements == null) {
            return []
        }

        return event?.properties.$elements as unknown as SurveyElement[]
    }
}
