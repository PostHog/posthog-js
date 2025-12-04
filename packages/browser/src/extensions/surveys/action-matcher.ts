import { PostHog } from '../../posthog-core'
import { ActionStepType, PropertyFilters, SurveyActionType, SurveyElement } from '../../posthog-surveys-types'
import { SimpleEventEmitter } from '../../utils/simple-event-emitter'
import { CaptureResult, PropertyMatchType } from '../../types'
import { isArray, isUndefined } from '@posthog/core'
import { matchPropertyFilters } from '../../utils/property-utils'
import { extractTexts, extractHref, matchString, matchTexts } from '../../utils/elements-chain-utils'

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
            this._checkStepEvent(event, step) &&
            this._checkStepUrl(event, step) &&
            this._checkStepElement(event, step) &&
            this._checkStepProperties(event, step)
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
                return false
            }
            if (!matchString(eventUrl, step.url, step.url_matching || 'contains')) {
                return false
            }
        }
        return true
    }

    private _checkStepElement(event?: CaptureResult, step?: ActionStepType): boolean {
        if (!this._checkStepHref(event, step)) return false
        if (!this._checkStepText(event, step)) return false
        if (!this._checkStepSelector(event, step)) return false
        return true
    }

    private _checkStepHref(event?: CaptureResult, step?: ActionStepType): boolean {
        if (!step?.href) return true

        const elements = this._getElementsList(event)
        if (elements.length > 0) {
            return elements.some((el) => matchString(el.href, step.href!, step.href_matching || 'exact'))
        }

        const chain = (event?.properties?.$elements_chain as string) || ''
        if (chain) {
            return matchString(extractHref(chain), step.href, step.href_matching || 'exact')
        }

        return false
    }

    private _checkStepText(event?: CaptureResult, step?: ActionStepType): boolean {
        if (!step?.text) return true

        const elements = this._getElementsList(event)
        if (elements.length > 0) {
            return elements.some(
                (el) =>
                    matchString(el.text, step.text!, step.text_matching || 'exact') ||
                    matchString(el.$el_text, step.text!, step.text_matching || 'exact')
            )
        }

        const chain = (event?.properties?.$elements_chain as string) || ''
        if (chain) {
            return matchTexts(extractTexts(chain), step.text, step.text_matching || 'exact')
        }

        return false
    }

    private _checkStepSelector(event?: CaptureResult, step?: ActionStepType): boolean {
        if (!step?.selector) return true

        // check exact match on $element_selectors from autocapture
        const elementSelectors = event?.properties?.$element_selectors as string[] | undefined
        if (elementSelectors?.includes(step.selector)) {
            return true
        }

        // check against compiled regex
        const chain = (event?.properties?.$elements_chain as string) || ''
        if (step.selector_regex && chain) {
            try {
                return new RegExp(step.selector_regex).test(chain)
            } catch {
                return false
            }
        }

        return false
    }

    private _getElementsList(event?: CaptureResult): SurveyElement[] {
        if (event?.properties?.$elements == null) {
            return []
        }

        return event?.properties.$elements as unknown as SurveyElement[]
    }

    private _checkStepProperties(event?: CaptureResult, step?: ActionStepType): boolean {
        if (!step?.properties || step.properties.length === 0) {
            return true
        }

        // transform to match same property format as normal events
        const propertyFilters: PropertyFilters = step.properties.reduce<PropertyFilters>((acc, filter) => {
            const values = isArray(filter.value)
                ? filter.value.map(String)
                : filter.value != null
                  ? [String(filter.value)]
                  : []

            acc[filter.key] = {
                values,
                operator: (filter.operator || 'exact') as PropertyMatchType,
            }
            return acc
        }, {})

        return matchPropertyFilters(propertyFilters, event?.properties)
    }
}
