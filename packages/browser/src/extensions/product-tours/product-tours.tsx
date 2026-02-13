import { render } from 'preact'
import { PostHog } from '../../posthog-core'
import {
    ProductTour,
    ProductTourBannerConfig,
    ProductTourCallback,
    ProductTourDismissReason,
    ProductTourRenderReason,
    ProductTourStepButton,
    ShowTourOptions,
} from '../../posthog-product-tours-types'
import { SurveyEventName, SurveyEventProperties } from '../../posthog-surveys-types'
import {
    addProductTourCSSVariablesToElement,
    findStepElement,
    getElementMetadata,
    getProductTourStylesheet,
    getStepImageUrls,
    hasElementTarget,
    normalizeUrl,
} from './product-tours-utils'
import { ProductTourTooltip } from './components/ProductTourTooltip'
import { ProductTourBanner } from './components/ProductTourBanner'
import { createLogger } from '../../utils/logger'
import { document as _document, window as _window } from '../../utils/globals'
import { localStore, sessionStore } from '../../storage'
import { addEventListener } from '../../utils'
import { isNull, SurveyMatchType } from '@posthog/core'
import { propertyComparisons } from '../../utils/property-utils'
import {
    TOUR_SHOWN_KEY_PREFIX,
    TOUR_COMPLETED_KEY_PREFIX,
    TOUR_DISMISSED_KEY_PREFIX,
    ACTIVE_TOUR_SESSION_KEY,
} from './constants'
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

function retrieveBannerShadow(
    tour: ProductTour,
    bannerConfig?: ProductTourBannerConfig
): { shadow: ShadowRoot; isNewlyCreated: boolean } | null {
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

    if (bannerConfig?.behavior === 'custom' && bannerConfig.selector) {
        const customContainer = document.querySelector(bannerConfig.selector)
        if (customContainer) {
            customContainer.appendChild(div)
        } else {
            logger.warn(`Custom banner container not found: ${bannerConfig.selector}. Banner will not be displayed.`)
            return null
        }
    } else {
        document.body.insertBefore(div, document.body.firstChild)
    }

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

const PRODUCT_TOUR_TARGETING_FLAG_PREFIX = 'product-tour-targeting-'

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
    private _preloadedImageUrls: Set<string> = new Set()

    constructor(instance: PostHog) {
        this._instance = instance
        this._eventReceiver = new ProductTourEventReceiver(instance)
    }

    private _preloadTourImages(tours: ProductTour[]): void {
        const urls = tours
            .filter((tour) => !tour.disable_image_preload)
            .flatMap((tour) => tour.steps.flatMap(getStepImageUrls))

        for (const url of urls) {
            if (!this._preloadedImageUrls.has(url)) {
                this._preloadedImageUrls.add(url)
                new Image().src = url
            }
        }
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

        this._evaluateAndDisplayTours(true)
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

    private _evaluateAndDisplayTours(forceReload?: boolean): void {
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

            this._preloadTourImages(tours)

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
        }, forceReload)
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

        const displayFrequency = tour.display_frequency ?? 'until_interacted'
        const shownKey = `${TOUR_SHOWN_KEY_PREFIX}${tour.id}`
        const completedKey = `${TOUR_COMPLETED_KEY_PREFIX}${tour.id}`
        const dismissedKey = `${TOUR_DISMISSED_KEY_PREFIX}${tour.id}`

        switch (displayFrequency) {
            case 'show_once':
                if (localStore._get(shownKey)) {
                    logger.info(`Tour ${tour.id} already shown (show_once frequency)`)
                    return false
                }
                break

            case 'until_interacted':
                if (localStore._get(completedKey) || localStore._get(dismissedKey)) {
                    logger.info(`Tour ${tour.id} already completed or dismissed`)
                    return false
                }
                break

            case 'always':
            default:
                break
        }

        if (!this._isProductToursFeatureFlagEnabled({ flagKey: tour.internal_targeting_flag_key })) {
            logger.info(`Tour ${tour.id} failed feature flag check: ${tour.internal_targeting_flag_key}`)
            return false
        }

        const linkedFlagVariant = tour.conditions?.linkedFlagVariant
        if (
            !this._isProductToursFeatureFlagEnabled({ flagKey: tour.linked_flag_key, flagVariant: linkedFlagVariant })
        ) {
            logger.info(
                `Tour ${tour.id} failed feature flag check: ${tour.linked_flag_key}, variant: ${linkedFlagVariant}`
            )
            return false
        }

        return true
    }

    showTour(tour: ProductTour, options?: ShowTourOptions): boolean {
        const renderReason: ProductTourRenderReason = options?.reason ?? 'auto'

        this.cancelPendingTour(tour.id)

        this._activeTour = tour
        this._setStepIndex(0)

        const rendered = this._renderCurrentStep()

        if (rendered) {
            this._captureEvent('product tour shown', {
                $product_tour_id: tour.id,
                $product_tour_name: tour.name,
                $product_tour_iteration: tour.current_iteration || 1,
                $product_tour_render_reason: renderReason,
            })

            if (!this._isPreviewMode) {
                localStore._set(`${TOUR_SHOWN_KEY_PREFIX}${tour.id}`, true)

                this._instance.capture('$set', {
                    $set: { [`$product_tour_shown/${tour.id}`]: true },
                })
            }
        } else {
            this._cleanup()
        }

        return rendered
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

            this._instance.capture('$set', {
                $set: { [`$product_tour_dismissed/${this._activeTour.id}`]: true },
            })
        }

        window.dispatchEvent(
            new CustomEvent('PHProductTourDismissed', { detail: { tourId: this._activeTour.id, reason } })
        )

        this._cleanup()
    }

    private _handleButtonClick = (button: ProductTourStepButton): void => {
        if (this._activeTour) {
            const currentStep = this._activeTour.steps[this._currentStepIndex]
            if (currentStep) {
                this._captureEvent('product tour button clicked', {
                    $product_tour_id: this._activeTour.id,
                    $product_tour_name: this._activeTour.name,
                    $product_tour_iteration: this._activeTour.current_iteration || 1,
                    $product_tour_step_id: currentStep.id,
                    $product_tour_step_order: this._currentStepIndex,
                    $product_tour_button_text: button.text,
                    $product_tour_button_action: button.action,
                    ...(button.link && { $product_tour_button_link: button.link }),
                    ...(button.tourId && { $product_tour_button_tour_id: button.tourId }),
                })
            }
        }

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
                this._completeTour()
                break
            case 'trigger_tour':
                if (button.tourId) {
                    this._completeTour()
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

    private _renderCurrentStep(retryCount: number = 0): boolean {
        if (!this._activeTour) {
            return false
        }

        const step = this._activeTour.steps[this._currentStepIndex]
        if (!step) {
            logger.warn(`Step ${this._currentStepIndex} not found in tour ${this._activeTour.id}`)
            this._cleanup()
            return false
        }

        // Banner step - render full-width banner
        if (step.type === 'banner') {
            this._captureEvent('product tour step shown', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_type: 'banner',
            })

            this._isResuming = false
            this._renderBanner()
            return true
        }

        // Survey step - render native survey step component
        if (step.type === 'survey') {
            if (step.survey) {
                this._renderSurveyStep()
                return true
            }

            logger.warn('Unable to render survey step - survey data not found')
            return false
        }

        // Screen-positioned step (no element targeting) - render without a target element
        if (!hasElementTarget(step)) {
            this._captureEvent('product tour step shown', {
                $product_tour_id: this._activeTour.id,
                $product_tour_step_id: step.id,
                $product_tour_step_order: this._currentStepIndex,
                $product_tour_step_type: step.type,
            })

            this._isResuming = false
            this._renderTooltipWithPreact(null)
            return true
        }

        const result = findStepElement(step)

        const inferenceProps = {
            $use_manual_selector: step.useManualSelector ?? false,
            $inference_data_present: !!step.inferenceData,
        }

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

                return false
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

            if (this._currentStepIndex === 0 && !this._isResuming) {
                logger.warn(
                    `Tour "${this._activeTour.name}" failed to show: element for first step not found (${result.error})`
                )
                return false
            }

            logger.warn(
                `Tour "${this._activeTour.name}" dismissed: element for step ${this._currentStepIndex} became unavailable (${result.error})` +
                    (shouldWaitForElement ? ` after waiting ${waitDurationMs}ms` : '')
            )
            this.dismissTour('element_unavailable')
            return false
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
            return false
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
        return true
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

    private _renderBanner(): void {
        if (!this._activeTour) {
            return
        }

        const step = this._activeTour.steps[this._currentStepIndex]
        const result = retrieveBannerShadow(this._activeTour, step.bannerConfig)

        if (!result) {
            this._captureEvent('product tour banner container selector failed', {
                $product_tour_id: this._activeTour.id,
                $product_tour_banner_selector: step?.bannerConfig?.selector,
            })
            this.dismissTour('container_unavailable')
            return
        }

        const { shadow } = result

        const handleTriggerTour = () => {
            const tourId = step.bannerConfig?.action?.tourId
            if (tourId) {
                this._cleanup()
                this.showTourById(tourId)
            }
        }

        render(
            <ProductTourBanner
                step={step}
                onDismiss={() => this.dismissTour('user_clicked_skip')}
                onTriggerTour={handleTriggerTour}
                displayFrequency={this._activeTour.display_frequency}
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

    private _isProductToursFeatureFlagEnabled({ flagKey, flagVariant }: { flagKey?: string; flagVariant?: string }) {
        if (!flagKey) {
            return true
        }
        const isFeatureEnabled = !!this._instance.featureFlags.isFeatureEnabled(flagKey, {
            send_event: !flagKey.startsWith(PRODUCT_TOUR_TARGETING_FLAG_PREFIX),
        })
        let flagVariantCheck = true
        if (flagVariant) {
            const flagVariantValue = this._instance.featureFlags.getFeatureFlag(flagKey, { send_event: false })
            flagVariantCheck = flagVariantValue === flagVariant || flagVariant === 'any'
        }
        return isFeatureEnabled && flagVariantCheck
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
                if (this._activeTour) {
                    logger.info(`Tour ${tour.id} trigger clicked but another tour is active`)
                    return
                }

                let currentTour: ProductTour | undefined
                this._instance.productTours?.getProductTours((tours) => {
                    currentTour = tours.find((t) => t.id === tour.id)
                })

                if (!currentTour) {
                    logger.warn(`Tour ${tour.id} no longer exists. Removing stale listener.`)
                    this._removeTriggerSelectorListener(tour.id)
                    return
                }

                if (!isTourInDateRange(currentTour)) {
                    logger.warn(`Tour ${tour.id} trigger clicked, but tour is not launched - not showing tour.`)
                    return
                }

                logger.info(`Tour ${tour.id} triggered by click on ${selector}`)

                if (this.showTour(currentTour, { reason: 'trigger' })) {
                    event.preventDefault()
                } else {
                    logger.info(`Tour ${tour.id} failed to show; not intercepting click.`)
                }
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
        localStore._remove(`${TOUR_SHOWN_KEY_PREFIX}${tourId}`)
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
            if (
                key?.startsWith(TOUR_SHOWN_KEY_PREFIX) ||
                key?.startsWith(TOUR_COMPLETED_KEY_PREFIX) ||
                key?.startsWith(TOUR_DISMISSED_KEY_PREFIX)
            ) {
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
