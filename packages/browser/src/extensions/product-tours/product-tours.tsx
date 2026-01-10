import { render } from 'preact'
import { PostHog } from '../../posthog-core'
import {
    ProductTour,
    ProductTourCallback,
    ProductTourDismissReason,
    ProductTourRenderReason,
    ProductTourStepButton,
    ShowTourOptions,
} from '../../posthog-product-tours-types'
import { SurveyEventName, SurveyEventProperties } from '../../posthog-surveys-types'
import {
    addProductTourCSSVariablesToElement,
    findElementBySelector,
    getElementMetadata,
    getProductTourStylesheet,
    normalizeUrl,
} from './product-tours-utils'
import { findElement } from './element-inference'
import { ProductTourTooltip } from './components/ProductTourTooltip'
import { createLogger } from '../../utils/logger'
import { document as _document, window as _window } from '../../utils/globals'
import { localStore, sessionStore } from '../../storage'
import { addEventListener } from '../../utils'
import { isNull, SurveyMatchType } from '@posthog/core'
import { propertyComparisons } from '../../utils/property-utils'
import { TOUR_COMPLETED_KEY_PREFIX, TOUR_DISMISSED_KEY_PREFIX, ACTIVE_TOUR_SESSION_KEY } from './constants'
import { doesTourActivateByAction, doesTourActivateByEvent } from '../../utils/product-tour-utils'
import { TOOLBAR_ID } from '../../constants'
import { ProductTourEventReceiver } from '../../utils/product-tour-event-receiver'

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

    const matchType = conditions.urlMatchType || SurveyMatchType.Icontains

    if (matchType === SurveyMatchType.Exact) {
        return normalizeUrl(href) === normalizeUrl(conditions.url)
    }

    const targets = [conditions.url]
    return propertyComparisons[matchType](targets, [href])
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
    return isTourInDateRange(tour) && doesTourUrlMatch(tour)
}

const CONTAINER_CLASS = 'ph-product-tour-container'
const TRIGGER_LISTENER_ATTRIBUTE = 'data-ph-tour-trigger'
const CHECK_INTERVAL_MS = 1000

interface TriggerListenerData {
    element: Element
    listener: (event: Event) => void
    tour: ProductTour
}

function retrieveTourShadow(tour: ProductTour): { shadow: ShadowRoot; isNewlyCreated: boolean } {
    const containerClass = `${CONTAINER_CLASS}-${tour.id}`
    const existingDiv = document.querySelector(`.${containerClass}`)

    if (existingDiv && existingDiv.shadowRoot) {
        return {
            shadow: existingDiv.shadowRoot,
            isNewlyCreated: false,
        }
    }

    const div = document.createElement('div')
    div.className = containerClass

    addProductTourCSSVariablesToElement(div, tour.appearance)

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
    private _isPreviewMode: boolean = false
    private _isResuming: boolean = false
    private _checkInterval: ReturnType<typeof setInterval> | null = null
    private _triggerSelectorListeners: Map<string, TriggerListenerData> = new Map()
    private _pendingTourTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private _eventReceiver: ProductTourEventReceiver
    private _registeredEventTourIds: Set<string> = new Set()

    constructor(instance: PostHog) {
        this._instance = instance
        this._eventReceiver = new ProductTourEventReceiver(instance)
    }

    private _setStepIndex(index: number): void {
        this._currentStepIndex = index
        this._saveSessionState()
    }

    private _saveSessionState(): void {
        if (!this._activeTour || this._isPreviewMode) {
            return
        }
        sessionStore._set(ACTIVE_TOUR_SESSION_KEY, {
            tourId: this._activeTour.id,
            stepIndex: this._currentStepIndex,
        })
    }

    private _clearSessionState(): void {
        sessionStore._remove(ACTIVE_TOUR_SESSION_KEY)
    }

    private _getSessionState(): { tourId: string; stepIndex: number } | null {
        const stored = sessionStore._get(ACTIVE_TOUR_SESSION_KEY)
        if (!stored) {
            return null
        }
        try {
            return JSON.parse(stored)
        } catch {
            return null
        }
    }

    start(): void {
        if (this._checkInterval) {
            return
        }

        // Check for saved session state before starting the evaluation loop
        const savedState = this._getSessionState()
        if (savedState) {
            this._resumeSavedTour(savedState.tourId, savedState.stepIndex, () => {
                this._startEvaluationLoop()
            })
        } else {
            this._startEvaluationLoop()
        }
    }

    private _startEvaluationLoop(): void {
        this._checkInterval = setInterval(() => {
            this._evaluateAndDisplayTours()
        }, CHECK_INTERVAL_MS)

        this._evaluateAndDisplayTours()
        addEventListener(document, 'visibilitychange', this._handleVisibilityChange)
    }

    private _resumeSavedTour(tourId: string, stepIndex: number, onComplete: () => void): void {
        this._instance.productTours?.getProductTours((tours) => {
            const tour = tours.find((t) => t.id === tourId)

            if (!tour) {
                if (tours.length > 0) {
                    this._clearSessionState()
                }
            } else {
                this._activeTour = tour
                this._currentStepIndex = stepIndex
                this._isResuming = true
                this._renderCurrentStep()
            }

            onComplete()
        })
    }

    stop(): void {
        if (this._checkInterval) {
            clearInterval(this._checkInterval)
            this._checkInterval = null
        }
        document.removeEventListener('visibilitychange', this._handleVisibilityChange)
        this._removeAllTriggerListeners()
        this._cancelAllPendingTours()
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
        if (document?.getElementById(TOOLBAR_ID)) {
            return
        }

        // Use getProductTours (not getActiveProductTours) because selector-triggered tours
        // should work even if completed/dismissed
        this._instance.productTours?.getProductTours((tours) => {
            if (tours.length === 0) {
                this._removeAllTriggerListeners()
                return
            }

            const activeTriggerTourIds = new Set<string>()

            const unregisteredEventTours = tours.filter(
                (tour: ProductTour) =>
                    !this._registeredEventTourIds.has(tour.id) &&
                    (doesTourActivateByEvent(tour) || doesTourActivateByAction(tour))
            )
            if (unregisteredEventTours.length > 0) {
                this._eventReceiver.register(unregisteredEventTours)
                unregisteredEventTours.forEach((tour) => this._registeredEventTourIds.add(tour.id))
            }

            const eventActivatedTourIds = this._activeTour ? [] : this._eventReceiver.getTours()

            /**
             * tours can be shown three ways, really:
             *
             * 1) selector clicks
             * 2a) auto-show immediately
             * 2b) auto-show after event/action
             *
             * (1) and (2[a|b]) are fully independent of each other
             */
            for (const tour of tours) {
                // 1) SELECTOR CLICK TRIGGER - just attach an event listener and keep going
                const triggerSelector = tour.conditions?.selector
                if (triggerSelector) {
                    activeTriggerTourIds.add(tour.id)
                    this._manageTriggerSelectorListener(tour, triggerSelector)
                }

                // skip auto-launch checks if a tour is already active
                if (this._activeTour) {
                    continue
                }

                // 2) AUTO-LAUNCH
                const hasEventOrActionTriggers = doesTourActivateByAction(tour) || doesTourActivateByEvent(tour)

                if (tour.auto_launch && this._isTourEligible(tour)) {
                    // tour should auto-launch, and the current session is eligible

                    if (!hasEventOrActionTriggers) {
                        // 2a) AUTO-SHOW WITH NO EVENT/ACTION
                        this._showOrQueueTour(tour, 'auto')
                        continue
                    }

                    // 2b) AUTO-SHOW, BUT WAIT FOR EVENT/ACTION
                    if (eventActivatedTourIds.includes(tour.id)) {
                        this._showOrQueueTour(tour, 'event')
                    }
                }
            }

            this._triggerSelectorListeners.forEach(({ tour }) => {
                if (!activeTriggerTourIds.has(tour.id)) {
                    this._removeTriggerSelectorListener(tour.id)
                }
            })
        })
    }

    private _showOrQueueTour(tour: ProductTour, reason: ProductTourRenderReason): void {
        const delaySeconds = tour.conditions?.autoShowDelaySeconds || 0
        if (delaySeconds > 0) {
            if (!this.isTourPending(tour.id)) {
                this.queueTourWithDelay(tour.id, delaySeconds, reason)
            }
        } else {
            this.showTour(tour, { reason })
        }
    }

    private _isTourEligible(tour: ProductTour): boolean {
        if (!checkTourConditions(tour)) {
            logger.info(`Tour ${tour.id} failed conditions check`)
            return false
        }

        const completedKey = `${TOUR_COMPLETED_KEY_PREFIX}${tour.id}`
        const dismissedKey = `${TOUR_DISMISSED_KEY_PREFIX}${tour.id}`

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

    showTour(tour: ProductTour, options?: ShowTourOptions): void {
        const renderReason: ProductTourRenderReason = options?.reason ?? 'auto'

        this.cancelPendingTour(tour.id)

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
                `Tour "${tour.name}" (${tour.id}): ${selectorFailures.length} selector(s) failed to match:\n  - ${failedSelectors.join('\n  - ')}${options?.enableStrictValidation === true ? '\n\nenableStrictValidation is true, not displaying tour.' : ''}`
            )
            if (options?.enableStrictValidation === true) return
        }

        this._activeTour = tour
        this._setStepIndex(0)

        this._captureEvent('product tour shown', {
            $product_tour_id: tour.id,
            $product_tour_name: tour.name,
            $product_tour_iteration: tour.current_iteration || 1,
            $product_tour_render_reason: renderReason,
        })

        this._renderCurrentStep()
    }

    showTourById(tourId: string, reason?: ProductTourRenderReason): void {
        logger.info(`showTourById(${tourId})`)
        this._instance.productTours?.getProductTours((tours) => {
            const tour = tours.find((t) => t.id === tourId)
            if (tour) {
                this.showTour(tour, { reason: reason ?? 'api' })
            } else {
                logger.warn('could not find tour', tourId)
            }
        })
    }

    previewTour(tour: ProductTour): void {
        logger.info(`Previewing tour ${tour.id}`)

        this._cleanup()

        this._isPreviewMode = true
        this._activeTour = tour
        this._currentStepIndex = 0

        this._renderCurrentStep()
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
            this._setStepIndex(this._currentStepIndex + 1)
            this._renderCurrentStep()
        } else {
            this._completeTour()
        }
    }

    previousStep = (): void => {
        if (!this._activeTour || this._currentStepIndex === 0) {
            return
        }

        this._setStepIndex(this._currentStepIndex - 1)
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

        if (!this._isPreviewMode) {
            localStore._set(`${TOUR_DISMISSED_KEY_PREFIX}${this._activeTour.id}`, true)
        }

        window.dispatchEvent(
            new CustomEvent('PHProductTourDismissed', { detail: { tourId: this._activeTour.id, reason } })
        )

        this._cleanup()
    }

    private _handleButtonClick = (button: ProductTourStepButton): void => {
        switch (button.action) {
            case 'dismiss':
                this.dismissTour('user_clicked_skip')
                break
            case 'next_step':
                this.nextStep()
                break
            case 'previous_step':
                this.previousStep()
                break
            case 'link':
                if (button.link) {
                    window.open(button.link, '_blank')
                }
                break
            case 'trigger_tour':
                if (button.tourId) {
                    this._cleanup()
                    this.showTourById(button.tourId)
                }
                break
        }
    }

    private _completeTour(): void {
        if (!this._activeTour) {
            return
        }

        this._captureEvent('product tour completed', {
            $product_tour_id: this._activeTour.id,
            $product_tour_steps_count: this._activeTour.steps.length,
        })

        if (!this._isPreviewMode) {
            localStore._set(`${TOUR_COMPLETED_KEY_PREFIX}${this._activeTour.id}`, true)

            this._instance.capture('$set', {
                $set: {
                    [`$product_tour_completed/${this._activeTour.id}`]: true,
                },
            })
        }

        window.dispatchEvent(new CustomEvent('PHProductTourCompleted', { detail: { tourId: this._activeTour.id } }))

        this._cleanup()
    }

    private _renderCurrentStep(retryCount: number = 0): void {
        if (!this._activeTour) {
            return
        }

        const step = this._activeTour.steps[this._currentStepIndex]
        if (!step) {
            logger.warn(`Step ${this._currentStepIndex} not found in tour ${this._activeTour.id}`)
            this._cleanup()
            return
        }

        // Survey step - render native survey step component
        if (step.type === 'survey') {
            if (step.survey) {
                this._renderSurveyStep()
            } else {
                logger.warn('Unable to render survey step - survey data not found')
            }

            return
        }

        // Modal step (no selector) - render without a target element
        if (step.type === 'modal') {
            this._captureEvent('product tour step shown', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_type: 'modal',
            })

            this._isResuming = false
            this._renderTooltipWithPreact(null)
            return
        }

        if (!step.selector) {
            logger.warn('Unable to render element step - no selector defined.')
            return
        }

        const result = findElementBySelector(step.selector)

        // shadow mode: try inference to compare with selector results
        const inferenceProps = step.inferenceData
            ? (() => {
                  const inferenceElement = findElement(step.inferenceData)
                  return {
                      $inference_data_present: true,
                      $inference_found: !!inferenceElement,
                      $inference_matches_selector: result.element === inferenceElement,
                  }
              })()
            : { $inference_data_present: false }

        const previousStep = this._currentStepIndex > 0 ? this._activeTour.steps[this._currentStepIndex - 1] : null
        const shouldWaitForElement = previousStep?.progressionTrigger === 'click' || this._isResuming

        // 2s total timeout
        const maxRetries = 20
        const retryTimeout = 100

        if (result.error === 'not_found' || result.error === 'not_visible') {
            // if previous step was click-to-progress, or we are resuming a tour,
            // give some time for the next element
            if (shouldWaitForElement && retryCount < maxRetries) {
                setTimeout(() => {
                    this._renderCurrentStep(retryCount + 1)
                }, retryTimeout)
                return
            }

            const waitDurationMs = retryCount * retryTimeout

            this._captureEvent('product tour step selector failed', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_selector: step.selector,
                $product_tour_error: result.error,
                $product_tour_matches_count: result.matchCount,
                $product_tour_failure_phase: 'runtime',
                $product_tour_waited_for_element: shouldWaitForElement,
                $product_tour_wait_duration_ms: waitDurationMs,
                ...inferenceProps,
            })

            logger.warn(
                `Tour "${this._activeTour.name}" dismissed: element for step ${this._currentStepIndex} became unavailable (${result.error})` +
                    (shouldWaitForElement ? ` after waiting ${waitDurationMs}ms` : '')
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
                ...inferenceProps,
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
            ...inferenceProps,
        })

        this._isResuming = false
        this._renderTooltipWithPreact(element)
    }

    private _renderTooltipWithPreact(
        element: HTMLElement | null,
        onSurveySubmit?: (response: string | number | null) => void,
        onDismissOverride?: (reason: ProductTourDismissReason) => void
    ): void {
        if (!this._activeTour) {
            return
        }

        const step = this._activeTour.steps[this._currentStepIndex]
        const { shadow } = retrieveTourShadow(this._activeTour)

        render(
            <ProductTourTooltip
                tour={this._activeTour}
                step={step}
                stepIndex={this._currentStepIndex}
                totalSteps={this._activeTour.steps.length}
                targetElement={element}
                onNext={this.nextStep}
                onPrevious={this.previousStep}
                onDismiss={onDismissOverride || this.dismissTour}
                onSurveySubmit={onSurveySubmit}
                onButtonClick={this._handleButtonClick}
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

        this._renderTooltipWithPreact(null, handleSubmit, handleDismiss)

        logger.info(`Rendered survey step for tour step ${this._currentStepIndex}`)
    }

    private _cleanup(): void {
        if (this._activeTour) {
            removeTourFromDom(this._activeTour.id)
        }

        this._activeTour = null
        this._currentStepIndex = 0
        this._isPreviewMode = false
        this._isResuming = false
        this._clearSessionState()
    }

    private _manageTriggerSelectorListener(tour: ProductTour, selector: string): void {
        const currentElement = document.querySelector(selector)
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

                // manual triggers only check launch status, no other conditions
                if (!isTourInDateRange(tour)) {
                    logger.warn(`Tour ${tour.id} trigger clicked, but tour is not launched - not showing tour.`)
                    return
                }

                logger.info(`Tour ${tour.id} triggered by click on ${selector}`)
                this.showTour(tour, { reason: 'trigger' })
            }

            addEventListener(currentElement, 'click', listener)
            currentElement.setAttribute(TRIGGER_LISTENER_ATTRIBUTE, tour.id)
            this._triggerSelectorListeners.set(tour.id, { element: currentElement, listener, tour })
            logger.info(`Attached trigger listener for tour ${tour.id} on ${selector}`)
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
        if (this._isPreviewMode) {
            return
        }
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
        localStore._remove(`${TOUR_COMPLETED_KEY_PREFIX}${tourId}`)
        localStore._remove(`${TOUR_DISMISSED_KEY_PREFIX}${tourId}`)
    }

    resetAllTours(): void {
        const storage = window?.localStorage
        if (!storage) {
            return
        }
        const keysToRemove: string[] = []
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i)
            if (key?.startsWith(TOUR_COMPLETED_KEY_PREFIX) || key?.startsWith(TOUR_DISMISSED_KEY_PREFIX)) {
                keysToRemove.push(key)
            }
        }
        keysToRemove.forEach((key) => localStore._remove(key))
    }

    cancelPendingTour(tourId: string): void {
        const timeout = this._pendingTourTimeouts.get(tourId)
        if (timeout) {
            clearTimeout(timeout)
            this._pendingTourTimeouts.delete(tourId)
            logger.info(`Cancelled pending tour: ${tourId}`)
        }
    }

    private _cancelAllPendingTours(): void {
        this._pendingTourTimeouts.forEach((timeout) => clearTimeout(timeout))
        this._pendingTourTimeouts.clear()
    }

    isTourPending(tourId: string): boolean {
        return this._pendingTourTimeouts.has(tourId)
    }

    queueTourWithDelay(tourId: string, delaySeconds: number, reason?: ProductTourRenderReason): void {
        logger.info(`Queueing tour ${tourId} with ${delaySeconds}s delay`)

        const timeoutId = setTimeout(() => {
            this._pendingTourTimeouts.delete(tourId)
            logger.info(`Delay elapsed for tour ${tourId}, showing now`)
            this.showTourById(tourId, reason)
        }, delaySeconds * 1000)

        this._pendingTourTimeouts.set(tourId, timeoutId)
    }
}
