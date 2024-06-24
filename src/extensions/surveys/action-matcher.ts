import { PostHog } from '../../posthog-core'
import type { ActionStepStringMatching, ActionStepType, ActionType } from '../../posthog-surveys-types'
import { SimpleEventEmitter } from '../../utils/simple-event-emitter'
import { CaptureResult } from '../../types'
import { isUndefined } from '../../utils/type-utils'

export class ActionMatcher {
    private actionRegistry?: Set<ActionType>
    private readonly instance?: PostHog
    private actionEvents: Set<string>
    private _debugEventEmitter = new SimpleEventEmitter()

    constructor(instance?: PostHog) {
        this.instance = instance
        this.actionEvents = new Set<string>()
        this.actionRegistry = new Set<ActionType>()
    }

    init() {
        if (!isUndefined(this.instance?._addCaptureHook)) {
            const onEventName = (eventName: string, eventPayload: any) => {
                // eslint-disable-next-line no-console
                console.log(` in action matcher, payload is `, eventPayload)
                this.on(eventName, eventPayload)
            }
            this.instance?._addCaptureHook(onEventName)
        }
    }

    register(actions: ActionType[]): void {
        // const eventMap = new Map<number, ActionType> (actions?.map((a) => [a.action_id, a])) =
        // this.actionRegistry = new Map<number, ActionType> (actions?.map((a) => [a.action_id, a]))

        actions.forEach((action) => {
            this.actionRegistry?.add(action)
            action.steps
                ?.filter((step) => step.event != null)
                .forEach((step) => {
                    this.actionEvents?.add(step.event!)
                })
        })
    }

    on(eventName: string, eventPayload?: CaptureResult) {
        // eslint-disable-next-line no-console
        console.log(`in action matcher, known events are `, this.actionEvents, ` receieved event `, eventName)
        if (!this.actionEvents.has(eventName) && !this.actionEvents.has(<string>eventPayload?.event)) {
            // eslint-disable-next-line no-console
            console.log(`no idea what this event is `, eventName)
            return
        }

        // eslint-disable-next-line no-console
        // console.log(`in action matcher, event registry is `, this.actionRegistry)
        if (this.actionRegistry && this.actionRegistry?.size > 0) {
            this.actionRegistry.forEach((action) => {
                if (this.checkAction(eventPayload, action)) {
                    // eslint-disable-next-line no-console
                    console.log(`in action matcher, emitting event with payload `, action.id)
                    this._debugEventEmitter.emit('actionCaptured', action.id)
                }
            })
        }
    }

    _addActionHook(callback: (actionId: number, eventPayload?: any) => void): void {
        this.onAction('actionCaptured', (data) => callback(data))
    }

    private checkAction(event?: CaptureResult, action?: ActionType): boolean {
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
        return this.checkStepEvent(event, step) && this.checkStepUrl(event, step)
        // &&
        //    this.checkStepEvent(event, step) &&
        //    // The below checks are less performant may parse the elements chain or do a database query hence moved to the end
        //    this.checkStepElement(event, step) &&
        //    (await this.checkStepFilters(event, step))
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
            if (!this.matchString(eventUrl, step.url, step.url_matching || 'contains')) {
                return false // URL IS A MISMATCH
            }
        }
        return true
    }

    private matchString(actual: string, expected: string, matching: ActionStepStringMatching): boolean {
        switch (matching) {
            // case ActionStepStringMatching.Regex:
            //     // Using RE2 here because that's what ClickHouse uses for regex matching anyway
            //     // It's also safer for user-provided patterns because of a few explicit limitations
            //     try {
            //         return new RE2(expected).test(actual)
            //     } catch {
            //         return false
            //     }
            case 'exact':
                return expected === actual
            // case ActionStepStringMatching.Contains:
            //     // Simulating SQL LIKE behavior (_ = any single character, % = any zero or more characters)
            //     const adjustedRegExpString = escapeStringRegexp(expected).replace(/_/g, '.').replace(/%/g, '.*')
            //     return new RegExp(adjustedRegExpString).test(actual)
            default:
                return false
        }
    }

    private checkStepElement(event: CaptureResult, step: ActionStepType): boolean {
        // CHECK CONDITIONS, OTHERWISE SKIPPED
        if (step.href || step.tag_name || step.text) {
            const elements = this.getElementsList(event)
            if (
                !elements.some((element) => {
                    if (
                        step.href &&
                        !matchString(element.href || '', step.href, step.href_matching || StringMatching.Exact)
                    ) {
                        return false // ELEMENT HREF IS A MISMATCH
                    }
                    if (step.tag_name && element.tag_name !== step.tag_name) {
                        return false // ELEMENT TAG NAME IS A MISMATCH
                    }
                    if (
                        step.text &&
                        !matchString(element.text || '', step.text, step.text_matching || StringMatching.Exact)
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
        if (step.selector && !this.checkElementsAgainstSelector(event, step.selector)) {
            return false // SELECTOR IS A MISMATCH
        }
        return true
    }

    private getElementsList(event: CaptureResult): Element[] {
        if (event.properties['$elements'] == null) {
            return []
        }

        return event.properties['$elements'] as unknown as Element[]
    }

    // private mutateCaptureResultWithElementsList(event: CaptureResult: Element[] {
    //      event.elementsList = event.elementsList.map((element) => ({
    //     ...element,
    //     attr_class: element.attributes?.attr__class ?? element.attr_class,
    //     $el_text: element.text,
    // }))
    // }
}
