import { render } from 'preact'
import { PostHog } from '../../posthog-core'
import {
    ProductTour,
    ProductTourCallback,
    ProductTourDismissReason,
    ProductTourRenderReason,
} from '../../posthog-product-tours-types'
import { SurveyEventName, SurveyEventProperties } from '../../posthog-surveys-types'
import { findElementBySelector, getElementMetadata, getProductTourStylesheet } from './product-tours-utils'
import { ProductTourTooltip } from './components/ProductTourTooltip'
import { ProductTourSurveyStep } from './components/ProductTourSurveyStep'
import { createLogger } from '../../utils/logger'
import { document as _document, window as _window } from '../../utils/globals'
import { localStore } from '../../storage'
import { addEventListener } from '../../utils'
import { isNull, SurveyMatchType } from '@posthog/core'
import { propertyComparisons } from '../../utils/property-utils'

const logger = createLogger('[Product Tours]')

const document = _document as Document
const window = _window as Window & typeof globalThis

// Tour condition checking - reuses the same URL matching logic as surveys
function doesTourUrlMatch(tour: ProductTour): boolean {
    const conditions = tour.conditions
    if (!conditions?.url) {
        return true
    }

    const href = window?.location?.href
    if (!href) {
        return false
    }

    const targets = [conditions.url]
    const matchType = conditions.urlMatchType || SurveyMatchType.Icontains
    return propertyComparisons[matchType](targets, [href])
}

function doesTourSelectorMatch(tour: ProductTour): boolean {
    const conditions = tour.conditions
    if (!conditions?.selector) {
        return true
    }

    try {
        return !isNull(document.querySelector(conditions.selector))
    } catch {
        return false
    }
}

function isTourInDateRange(tour: ProductTour): boolean {
    const now = new Date()

    if (tour.start_date) {
        const startDate = new Date(tour.start_date)
        if (now < startDate) {
            return false
        }
    }

    if (tour.end_date) {
        const endDate = new Date(tour.end_date)
        if (now > endDate) {
            return false
        }
    }

    return true
}

function checkTourConditions(tour: ProductTour): boolean {
    return isTourInDateRange(tour) && doesTourUrlMatch(tour) && doesTourSelectorMatch(tour)
}

const CONTAINER_CLASS = 'ph-product-tour-container'
const TRIGGER_LISTENER_ATTRIBUTE = 'data-ph-tour-trigger'
const CHECK_INTERVAL_MS = 1000

interface TriggerListenerData {
    element: Element
    listener: (event: Event) => void
    tour: ProductTour
}

function retrieveTourShadow(tourId: string): { shadow: ShadowRoot; isNewlyCreated: boolean } {
    const containerClass = `${CONTAINER_CLASS}-${tourId}`
    const existingDiv = document.querySelector(`.${containerClass}`)

    if (existingDiv && existingDiv.shadowRoot) {
        return {
            shadow: existingDiv.shadowRoot,
            isNewlyCreated: false,
        }
    }

    const div = document.createElement('div')
    div.className = containerClass
    const shadow = div.attachShadow({ mode: 'open' })

    const stylesheet = getProductTourStylesheet()
    if (stylesheet) {
        shadow.appendChild(stylesheet)
    }

    document.body.appendChild(div)

    return {
        shadow,
        isNewlyCreated: true,
    }
}

function removeTourFromDom(tourId: string): void {
    const containerClass = `${CONTAINER_CLASS}-${tourId}`
    const container = document.querySelector(`.${containerClass}`)
    if (container?.shadowRoot) {
        render(null, container.shadowRoot)
    }
    container?.remove()
}

export class ProductTourManager {
    private _instance: PostHog
    private _activeTour: ProductTour | null = null
    private _currentStepIndex: number = 0
    private _renderReason: ProductTourRenderReason = 'auto'
    private _checkInterval: ReturnType<typeof setInterval> | null = null
    private _triggerSelectorListeners: Map<string, TriggerListenerData> = new Map()

    constructor(instance: PostHog) {
        this._instance = instance
    }

    start(): void {
        if (this._checkInterval) {
            return
        }

        this._checkInterval = setInterval(() => {
            this._evaluateAndDisplayTours()
        }, CHECK_INTERVAL_MS)

        this._evaluateAndDisplayTours()
        addEventListener(document, 'visibilitychange', this._handleVisibilityChange)
    }

    stop(): void {
        if (this._checkInterval) {
            clearInterval(this._checkInterval)
            this._checkInterval = null
        }
        document.removeEventListener('visibilitychange', this._handleVisibilityChange)
        this._removeAllTriggerListeners()
        this._cleanup()
    }

    private _handleVisibilityChange = (): void => {
        if (document.hidden && this._checkInterval) {
            clearInterval(this._checkInterval)
            this._checkInterval = null
        } else if (!document.hidden && !this._checkInterval) {
            this._checkInterval = setInterval(() => {
                this._evaluateAndDisplayTours()
            }, CHECK_INTERVAL_MS)
            this._evaluateAndDisplayTours()
        }
    }

    private _evaluateAndDisplayTours(): void {
        // Use getProductTours (not getActiveProductTours) because trigger_selector tours
        // should work even if completed/dismissed
        this._instance.productTours?.getProductTours((tours) => {
            if (tours.length === 0) {
                this._removeAllTriggerListeners()
                return
            }

            const activeTriggerTourIds = new Set<string>()

            for (const tour of tours) {
                // Determine the trigger selector - explicit trigger_selector takes precedence,
                // otherwise use conditions.selector for click-only tours (auto_launch=false)
                const triggerSelector = tour.trigger_selector || (!tour.auto_launch ? tour.conditions?.selector : null)

                // Tours with a trigger selector: always attach listener
                // These are "on-demand" tours that show when clicked
                if (triggerSelector) {
                    activeTriggerTourIds.add(tour.id)
                    this._manageTriggerSelectorListener({ ...tour, trigger_selector: triggerSelector })
                }

                // Only auto-show if auto_launch is enabled
                if (tour.auto_launch && !this._activeTour && this._isTourEligible(tour)) {
                    this.showTour(tour)
                }
            }

            this._triggerSelectorListeners.forEach(({ tour }) => {
                if (!activeTriggerTourIds.has(tour.id)) {
                    this._removeTriggerSelectorListener(tour.id)
                }
            })
        })
    }

    private _isTourEligible(tour: ProductTour): boolean {
        if (!checkTourConditions(tour)) {
            logger.info(`Tour ${tour.id} failed conditions check`)
            return false
        }

        const completedKey = `ph_product_tour_completed_${tour.id}`
        const dismissedKey = `ph_product_tour_dismissed_${tour.id}`

        if (localStore._get(completedKey) || localStore._get(dismissedKey)) {
            logger.info(`Tour ${tour.id} already completed or dismissed`)
            return false
        }

        if (tour.internal_targeting_flag_key) {
            const flagValue = this._instance.featureFlags?.getFeatureFlag(tour.internal_targeting_flag_key)
            if (!flagValue) {
                logger.info(`Tour ${tour.id} failed feature flag check: ${tour.internal_targeting_flag_key}`)
                return false
            }
        }

        return true
    }

    showTour(tour: ProductTour, reason: ProductTourRenderReason = 'auto'): void {
        // Validate all step selectors before showing the tour
        // Steps without selectors are modal steps and don't need validation
        const selectorFailures: Array<{
            stepIndex: number
            stepId: string
            selector: string
            error: string
            matchCount: number
        }> = []

        for (let i = 0; i < tour.steps.length; i++) {
            const step = tour.steps[i]

            // Skip validation for modal steps (no selector)
            if (!step.selector) {
                continue
            }

            const result = findElementBySelector(step.selector)

            if (result.error === 'not_found' || result.error === 'not_visible') {
                selectorFailures.push({
                    stepIndex: i,
                    stepId: step.id,
                    selector: step.selector,
                    error: result.error,
                    matchCount: result.matchCount,
                })
            }
        }

        if (selectorFailures.length > 0) {
            // Emit events for each failed selector for debugging/data purposes
            for (const failure of selectorFailures) {
                this._captureEvent('product tour step selector failed', {
                    $product_tour_id: tour.id,
                    $product_tour_step_id: failure.stepId,
                    $product_tour_step_order: failure.stepIndex,
                    $product_tour_step_selector: failure.selector,
                    $product_tour_error: failure.error,
                    $product_tour_matches_count: failure.matchCount,
                    $product_tour_failure_phase: 'validation',
                })
            }

            const failedSelectors = selectorFailures.map((f) => `Step ${f.stepIndex}: "${f.selector}" (${f.error})`)
            logger.warn(
                `Tour "${tour.name}" (${tour.id}) not shown: ${selectorFailures.length} selector(s) failed to match:\n  - ${failedSelectors.join('\n  - ')}`
            )
            return
        }

        this._activeTour = tour
        this._currentStepIndex = 0
        this._renderReason = reason

        this._captureEvent('product tour shown', {
            $product_tour_id: tour.id,
            $product_tour_name: tour.name,
            $product_tour_iteration: tour.current_iteration || 1,
            $product_tour_render_reason: reason,
        })

        this._renderCurrentStep()
    }

    showTourById(tourId: string): void {
        logger.info(`showTourById(${tourId})`)
        this._instance.productTours?.getProductTours((tours) => {
            const tour = tours.find((t) => t.id === tourId)
            if (tour) {
                logger.info(`found tour: `, tour)
                this.showTour(tour, 'api')
            } else {
                logger.info('could not find tour', tourId)
            }
        })
    }

    nextStep = (): void => {
        if (!this._activeTour) {
            return
        }

        const currentStep = this._activeTour.steps[this._currentStepIndex]

        this._captureEvent('product tour step completed', {
            $product_tour_id: this._activeTour.id,
            $product_tour_step_id: currentStep.id,
            $product_tour_step_order: this._currentStepIndex,
        })

        if (this._currentStepIndex < this._activeTour.steps.length - 1) {
            this._currentStepIndex++
            this._renderCurrentStep()
        } else {
            this._completeTour()
        }
    }

    previousStep = (): void => {
        if (!this._activeTour || this._currentStepIndex === 0) {
            return
        }

        this._currentStepIndex--
        this._renderCurrentStep()
    }

    dismissTour = (reason: ProductTourDismissReason = 'user_clicked_skip'): void => {
        if (!this._activeTour) {
            return
        }

        const currentStep = this._activeTour.steps[this._currentStepIndex]

        this._captureEvent('product tour dismissed', {
            $product_tour_id: this._activeTour.id,
            $product_tour_step_id: currentStep.id,
            $product_tour_step_order: this._currentStepIndex,
            $product_tour_dismiss_reason: reason,
        })

        localStore._set(`ph_product_tour_dismissed_${this._activeTour.id}`, true)

        this._cleanup()
    }

    private _completeTour(): void {
        if (!this._activeTour) {
            return
        }

        this._captureEvent('product tour completed', {
            $product_tour_id: this._activeTour.id,
            $product_tour_steps_count: this._activeTour.steps.length,
        })

        localStore._set(`ph_product_tour_completed_${this._activeTour.id}`, true)

        this._instance.capture('$set', {
            $set: {
                [`$product_tour_completed/${this._activeTour.id}`]: true,
            },
        })

        this._cleanup()
    }

    private _renderCurrentStep(): void {
        if (!this._activeTour) {
            return
        }

        const step = this._activeTour.steps[this._currentStepIndex]

        // Survey step - render native survey step component
        if (step.survey) {
            this._renderSurveyStep()
            return
        }

        // Modal step (no selector) - render without a target element
        if (!step.selector) {
            this._captureEvent('product tour step shown', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_type: 'modal',
            })

            this._renderTooltipWithPreact(null)
            return
        }

        const result = findElementBySelector(step.selector)

        if (result.error === 'not_found' || result.error === 'not_visible') {
            this._captureEvent('product tour step selector failed', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_selector: step.selector,
                $product_tour_error: result.error,
                $product_tour_matches_count: result.matchCount,
                $product_tour_failure_phase: 'runtime',
            })

            logger.warn(
                `Tour "${this._activeTour.name}" dismissed: element for step ${this._currentStepIndex} became unavailable (${result.error})`
            )
            this.dismissTour('element_unavailable')
            return
        }

        if (result.error === 'multiple_matches') {
            this._captureEvent('product tour step selector failed', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_selector: step.selector,
                $product_tour_error: result.error,
                $product_tour_matches_count: result.matchCount,
                $product_tour_failure_phase: 'runtime',
            })
            // Continue with first match for multiple_matches case
        }

        if (!result.element) {
            return
        }

        const element = result.element
        const metadata = getElementMetadata(element)

        this._captureEvent('product tour step shown', {
            $product_tour_id: this._activeTour.id,
            $product_tour_step_id: step.id,
            $product_tour_step_order: this._currentStepIndex,
            $product_tour_step_selector: step.selector,
            $product_tour_step_selector_found: true,
            $product_tour_step_element_tag: metadata.tag,
            $product_tour_step_element_id: metadata.id,
            $product_tour_step_element_classes: metadata.classes,
            $product_tour_step_element_text: metadata.text,
        })

        this._renderTooltipWithPreact(element)
    }

    private _renderTooltipWithPreact(element: HTMLElement | null): void {
        if (!this._activeTour) {
            return
        }

        const step = this._activeTour.steps[this._currentStepIndex]
        const { shadow } = retrieveTourShadow(this._activeTour.id)

        render(
            <ProductTourTooltip
                tour={this._activeTour}
                step={step}
                stepIndex={this._currentStepIndex}
                totalSteps={this._activeTour.steps.length}
                targetElement={element}
                onNext={this.nextStep}
                onPrevious={this.previousStep}
                onDismiss={this.dismissTour}
            />,
            shadow
        )
    }

    private _renderSurveyStep(): void {
        if (!this._activeTour) {
            return
        }

        const tourId = this._activeTour.id
        const step = this._activeTour.steps[this._currentStepIndex]
        const surveyId = step.linkedSurveyId
        const questionId = step.linkedSurveyQuestionId
        const questionText = step.survey?.questionText || ''

        this._captureEvent('product tour step shown', {
            $product_tour_id: this._activeTour.id,
            $product_tour_step_id: step.id,
            $product_tour_step_order: this._currentStepIndex,
            $product_tour_step_type: 'survey',
            $product_tour_linked_survey_id: surveyId,
        })

        this._captureEvent(SurveyEventName.SHOWN, {
            [SurveyEventProperties.SURVEY_ID]: surveyId,
            [SurveyEventProperties.PRODUCT_TOUR_ID]: tourId,
            sessionRecordingUrl: this._instance.get_session_replay_url?.(),
        })

        const { shadow } = retrieveTourShadow(this._activeTour.id)

        const handleSubmit = (response: string | number | null) => {
            const responseKey = questionId ? `$survey_response_${questionId}` : '$survey_response'
            this._captureEvent(SurveyEventName.SENT, {
                [SurveyEventProperties.SURVEY_ID]: surveyId,
                [SurveyEventProperties.PRODUCT_TOUR_ID]: tourId,
                [SurveyEventProperties.SURVEY_QUESTIONS]: [
                    {
                        id: questionId,
                        question: questionText,
                        response: response,
                    },
                ],
                [SurveyEventProperties.SURVEY_COMPLETED]: true,
                sessionRecordingUrl: this._instance.get_session_replay_url?.(),
                ...(!isNull(response) && { [responseKey]: response }),
            })

            logger.info(`Survey ${surveyId} completed`, !isNull(response) ? `with response: ${response}` : '(skipped)')
            this.nextStep()
        }

        const handleDismiss = (reason: ProductTourDismissReason) => {
            this._captureEvent(SurveyEventName.DISMISSED, {
                [SurveyEventProperties.SURVEY_ID]: surveyId,
                [SurveyEventProperties.PRODUCT_TOUR_ID]: tourId,
                [SurveyEventProperties.SURVEY_QUESTIONS]: [
                    {
                        id: questionId,
                        question: questionText,
                        response: null,
                    },
                ],
                [SurveyEventProperties.SURVEY_PARTIALLY_COMPLETED]: false,
                sessionRecordingUrl: this._instance.get_session_replay_url?.(),
            })

            logger.info(`Survey ${surveyId} dismissed`)
            this.dismissTour(reason)
        }

        render(
            <ProductTourSurveyStep
                tour={this._activeTour}
                step={step}
                stepIndex={this._currentStepIndex}
                totalSteps={this._activeTour.steps.length}
                onSubmit={handleSubmit}
                onPrevious={this.previousStep}
                onDismiss={handleDismiss}
            />,
            shadow
        )

        logger.info(`Rendered survey step for tour step ${this._currentStepIndex}`)
    }

    private _cleanup(): void {
        if (this._activeTour) {
            removeTourFromDom(this._activeTour.id)
        }

        this._activeTour = null
        this._currentStepIndex = 0
        this._renderReason = 'auto'
    }

    private _manageTriggerSelectorListener(tour: ProductTour): void {
        if (!tour.trigger_selector) {
            return
        }

        const currentElement = document.querySelector(tour.trigger_selector)
        const existingListenerData = this._triggerSelectorListeners.get(tour.id)

        if (!currentElement) {
            if (existingListenerData) {
                this._removeTriggerSelectorListener(tour.id)
            }
            return
        }

        if (existingListenerData) {
            if (currentElement !== existingListenerData.element) {
                logger.info(`Trigger element changed for tour ${tour.id}. Re-attaching listener.`)
                this._removeTriggerSelectorListener(tour.id)
            } else {
                return
            }
        }

        if (!currentElement.hasAttribute(TRIGGER_LISTENER_ATTRIBUTE)) {
            const listener = (event: Event) => {
                event.stopPropagation()

                if (this._activeTour) {
                    logger.info(`Tour ${tour.id} trigger clicked but another tour is active`)
                    return
                }

                logger.info(`Tour ${tour.id} triggered by click on ${tour.trigger_selector}`)
                this.showTour(tour, 'trigger')
            }

            addEventListener(currentElement, 'click', listener)
            currentElement.setAttribute(TRIGGER_LISTENER_ATTRIBUTE, tour.id)
            this._triggerSelectorListeners.set(tour.id, { element: currentElement, listener, tour })
            logger.info(`Attached trigger listener for tour ${tour.id} on ${tour.trigger_selector}`)
        }
    }

    private _removeTriggerSelectorListener(tourId: string): void {
        const existing = this._triggerSelectorListeners.get(tourId)
        if (existing) {
            existing.element.removeEventListener('click', existing.listener)
            existing.element.removeAttribute(TRIGGER_LISTENER_ATTRIBUTE)
            this._triggerSelectorListeners.delete(tourId)
            logger.info(`Removed trigger listener for tour ${tourId}`)
        }
    }

    private _removeAllTriggerListeners(): void {
        this._triggerSelectorListeners.forEach((_, tourId) => {
            this._removeTriggerSelectorListener(tourId)
        })
    }

    private _captureEvent(eventName: string, properties: Record<string, any>): void {
        this._instance.capture(eventName, properties)
    }

    // Public API methods delegated from PostHogProductTours
    getActiveProductTours(callback: ProductTourCallback): void {
        this._instance.productTours?.getProductTours((tours, context) => {
            if (!context?.isLoaded) {
                callback([], context)
                return
            }

            const activeTours = tours.filter((tour) => this._isTourEligible(tour))
            callback(activeTours, context)
        })
    }

    resetTour(tourId: string): void {
        localStore._remove(`ph_product_tour_completed_${tourId}`)
        localStore._remove(`ph_product_tour_dismissed_${tourId}`)
    }

    resetAllTours(): void {
        const storage = window?.localStorage
        if (!storage) {
            return
        }
        const keysToRemove: string[] = []
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i)
            if (key?.startsWith('ph_product_tour_completed_') || key?.startsWith('ph_product_tour_dismissed_')) {
                keysToRemove.push(key)
            }
        }
        keysToRemove.forEach((key) => localStore._remove(key))
    }
}
