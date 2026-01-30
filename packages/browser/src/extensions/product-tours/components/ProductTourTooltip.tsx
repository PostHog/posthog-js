import { h } from 'preact'
import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'preact/hooks'
import {
    ProductTour,
    ProductTourStep,
    ProductTourDismissReason,
    ProductTourStepButton,
} from '../../../posthog-product-tours-types'
import { isUndefined, SurveyPosition } from '@posthog/core'
import {
    calculateTooltipPosition,
    getSpotlightStyle,
    TooltipPosition,
    TooltipDimensions,
    PositionResult,
    findStepElement,
} from '../product-tours-utils'
import { getPopoverPosition } from '../../surveys/surveys-extension-utils'
import { addEventListener } from '../../../utils'
import { window as _window } from '../../../utils/globals'
import { ProductTourTooltipInner } from './ProductTourTooltipInner'
import { ProductTourSurveyStepInner } from './ProductTourSurveyStepInner'

const window = _window as Window & typeof globalThis

type TransitionState = 'entering' | 'visible' | 'exiting'

export interface ProductTourTooltipProps {
    tour: ProductTour
    step: ProductTourStep
    stepIndex: number
    totalSteps: number
    targetElement: HTMLElement | null
    onNext: () => void
    onPrevious: () => void
    onDismiss: (reason: ProductTourDismissReason) => void
    onSurveySubmit?: (response: string | number | null) => void
    onButtonClick?: (button: ProductTourStepButton) => void
}

function getOppositePosition(position: TooltipPosition): TooltipPosition {
    const opposites: Record<TooltipPosition, TooltipPosition> = {
        top: 'bottom',
        bottom: 'top',
        left: 'right',
        right: 'left',
    }
    return opposites[position]
}

function scrollToElement(element: HTMLElement, resolve: () => void): void {
    const initialRect = element.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    const safeMarginY = viewportHeight / 6
    const safeMarginX = viewportWidth / 6

    const isInSafeZone =
        initialRect.top >= safeMarginY &&
        initialRect.bottom <= viewportHeight - safeMarginY &&
        initialRect.left >= safeMarginX &&
        initialRect.right <= viewportWidth - safeMarginX

    if (isInSafeZone) {
        resolve()
        return
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' })

    let lastTop = initialRect.top
    let stableCount = 0
    let resolved = false

    const checkStability = () => {
        if (resolved) return

        const currentRect = element.getBoundingClientRect()
        if (Math.abs(currentRect.top - lastTop) < 1) {
            stableCount++
            if (stableCount >= 3) {
                resolved = true
                resolve()
                return
            }
        } else {
            stableCount = 0
        }
        lastTop = currentRect.top
        setTimeout(checkStability, 50)
    }

    setTimeout(checkStability, 30)

    setTimeout(() => {
        if (!resolved) {
            resolved = true
            resolve()
        }
    }, 500)
}

const TRANSITION_DURATION = 150

export function ProductTourTooltip({
    tour,
    step,
    stepIndex,
    totalSteps,
    targetElement,
    onNext,
    onPrevious,
    onDismiss,
    onSurveySubmit,
    onButtonClick,
}: ProductTourTooltipProps): h.JSX.Element {
    const [transitionState, setTransitionState] = useState<TransitionState>('entering')
    const [position, setPosition] = useState<PositionResult | null>(null)
    const [spotlightStyle, setSpotlightStyle] = useState<ReturnType<typeof getSpotlightStyle> | null>(null)
    const [isMeasured, setIsMeasured] = useState(false)

    const [displayedStep, setDisplayedStep] = useState(step)
    const [displayedStepIndex, setDisplayedStepIndex] = useState(stepIndex)

    const tooltipRef = useRef<HTMLDivElement>(null)
    const previousStepRef = useRef(stepIndex)
    const isTransitioningRef = useRef(false)
    const resolvedElementRef = useRef<HTMLElement | null>(targetElement)

    // Modal and survey steps use screen positioning (not anchored to an element)
    const isScreenPositioned = displayedStep.type === 'modal' || displayedStep.type === 'survey'

    useLayoutEffect(() => {
        resolvedElementRef.current = targetElement
    }, [targetElement])

    const updatePosition = useCallback(() => {
        const element = resolvedElementRef.current
        if (!element || !tooltipRef.current) return

        const tooltipRect = tooltipRef.current.getBoundingClientRect()
        const tooltipDimensions: TooltipDimensions = {
            width: tooltipRect.width,
            height: tooltipRect.height,
        }

        const targetRect = element.getBoundingClientRect()
        setPosition(calculateTooltipPosition(targetRect, tooltipDimensions))
        setSpotlightStyle(getSpotlightStyle(targetRect))
        setIsMeasured(true)
    }, [])

    useLayoutEffect(() => {
        if (!isScreenPositioned && !isMeasured && tooltipRef.current && targetElement) {
            updatePosition()
        }
    }, [isScreenPositioned, isMeasured, targetElement, updatePosition])

    useEffect(() => {
        const currentStepIndex = stepIndex
        const isStepChange = previousStepRef.current !== stepIndex

        const finishEntering = () => {
            if (previousStepRef.current !== currentStepIndex) return
            setTransitionState('visible')
            isTransitioningRef.current = false
        }

        const enterStep = () => {
            // Only scroll/position for element steps
            if (resolvedElementRef.current && step.type === 'element') {
                if (!resolvedElementRef.current.isConnected) {
                    resolvedElementRef.current = findStepElement(step).element
                }

                if (resolvedElementRef.current) {
                    scrollToElement(resolvedElementRef.current, () => {
                        if (previousStepRef.current !== currentStepIndex) return
                        updatePosition()
                        setTimeout(finishEntering, 50)
                    })
                    return
                }
            }

            setTimeout(finishEntering, 50)
        }

        if (!isStepChange) {
            previousStepRef.current = stepIndex
            isTransitioningRef.current = true
            enterStep()
            return
        }

        previousStepRef.current = stepIndex
        isTransitioningRef.current = true
        setTransitionState('exiting')

        setTimeout(() => {
            if (previousStepRef.current !== currentStepIndex) return

            // Reset position for element steps to prevent flash at old position
            if (step.type === 'element') {
                setPosition(null)
                setSpotlightStyle(null)
                setIsMeasured(false)
            }

            setDisplayedStep(step)
            setDisplayedStepIndex(stepIndex)
            setTransitionState('entering')

            enterStep()
        }, TRANSITION_DURATION)
    }, [targetElement, stepIndex, step, updatePosition])

    useEffect(() => {
        if (transitionState !== 'visible' || isScreenPositioned) return

        const handleUpdate = () => {
            if (!isTransitioningRef.current) {
                updatePosition()
            }
        }

        addEventListener(window, 'scroll', handleUpdate as EventListener, { capture: true })
        addEventListener(window, 'resize', handleUpdate as EventListener)

        return () => {
            window?.removeEventListener('scroll', handleUpdate, true)
            window?.removeEventListener('resize', handleUpdate)
        }
    }, [updatePosition, transitionState, isScreenPositioned])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onDismiss('escape_key')
            }
        }
        addEventListener(window, 'keydown', handleKeyDown as EventListener)
        return () => {
            window?.removeEventListener('keydown', handleKeyDown)
        }
    }, [onDismiss])

    const handleOverlayClick = (e: MouseEvent) => {
        e.stopPropagation()
        onDismiss('user_clicked_outside')
    }

    const handleTooltipClick = (e: MouseEvent) => {
        e.stopPropagation()
    }

    const handleSpotlightClick = (e: MouseEvent) => {
        e.stopPropagation()
        if (resolvedElementRef.current) {
            resolvedElementRef.current.click()
        }
        onNext()
    }

    const isVisible = transitionState === 'visible'
    const isSurvey = displayedStep.type === 'survey'

    // For element steps, position is ready once we've measured and calculated
    const isPositionReady = isScreenPositioned || isMeasured

    const basePosition = { top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', transform: 'none' }

    // surveys default to bottom: 0, and PT should not, so this is a little clunky
    const getModalPosition = () => {
        const pos = getPopoverPosition(undefined, displayedStep.modalPosition ?? SurveyPosition.MiddleCenter)
        if (!('top' in pos) && !('bottom' in pos)) {
            return { ...pos, bottom: '30px' }
        }
        return pos
    }

    const getElementPositionStyle = (): Record<string, string> => {
        if (!position) {
            return {}
        }

        const isHorizontal = position.position === 'left' || position.position === 'right'

        return {
            top: !isUndefined(position.top) ? `${position.top}px` : 'auto',
            bottom: !isUndefined(position.bottom) ? `${position.bottom}px` : 'auto',
            left: !isUndefined(position.left) ? `${position.left}px` : 'auto',
            right: !isUndefined(position.right) ? `${position.right}px` : 'auto',
            transform: isHorizontal ? 'translateY(-50%)' : 'translateX(-50%)',
        }
    }

    const tooltipStyle = {
        ...(displayedStep.maxWidth && {
            width: `min(${displayedStep.maxWidth}px, calc(100vw - 16px))`,
            maxWidth: `min(${displayedStep.maxWidth}px, calc(100vw - 16px))`,
        }),
        ...(isScreenPositioned
            ? {
                  ...basePosition,
                  ...getModalPosition(),
              }
            : getElementPositionStyle()),
    }

    return (
        <div class="ph-tour-container">
            {tour.appearance?.dismissOnClickOutside !== false && (
                <div class="ph-tour-click-overlay" onClick={handleOverlayClick} />
            )}

            {/* Modal overlay - visible for non-element steps */}
            <div
                class="ph-tour-modal-overlay"
                style={{
                    opacity: isScreenPositioned && isVisible ? 1 : 0,
                    transition: `opacity ${TRANSITION_DURATION}ms ease-out`,
                    pointerEvents: 'none',
                }}
            />

            {/* Spotlight - visible for element steps */}
            <div
                class="ph-tour-spotlight"
                style={{
                    ...(isVisible && isPositionReady && spotlightStyle
                        ? spotlightStyle
                        : { top: '50%', left: '50%', width: '0px', height: '0px' }),
                    opacity: !isScreenPositioned && isVisible && isPositionReady ? 1 : 0,
                    transition: `opacity ${TRANSITION_DURATION}ms ease-out`,
                    ...(displayedStep.progressionTrigger === 'click' &&
                        !isScreenPositioned && {
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                        }),
                }}
                onClick={
                    displayedStep.progressionTrigger === 'click' && !isScreenPositioned
                        ? handleSpotlightClick
                        : undefined
                }
            />

            <div
                ref={tooltipRef}
                class={`ph-tour-tooltip ${isScreenPositioned ? 'ph-tour-tooltip--modal' : ''} ${isSurvey ? 'ph-tour-survey-step' : ''}`}
                style={{
                    ...tooltipStyle,
                    opacity: isVisible && isPositionReady ? 1 : 0,
                    transition: `opacity ${TRANSITION_DURATION}ms ease-out`,
                }}
                onClick={handleTooltipClick}
            >
                {!isScreenPositioned && position && (
                    <div
                        class={`ph-tour-arrow ph-tour-arrow--${getOppositePosition(position.position)}`}
                        style={
                            position.arrowOffset !== 0
                                ? { '--ph-tour-arrow-offset': `${position.arrowOffset}px` }
                                : undefined
                        }
                    />
                )}

                {isSurvey ? (
                    <ProductTourSurveyStepInner
                        step={displayedStep}
                        appearance={tour.appearance}
                        stepIndex={displayedStepIndex}
                        totalSteps={totalSteps}
                        onSubmit={onSurveySubmit}
                        onPrevious={onPrevious}
                        onDismiss={() => onDismiss('user_clicked_skip')}
                    />
                ) : (
                    <ProductTourTooltipInner
                        step={displayedStep}
                        appearance={tour.appearance}
                        stepIndex={displayedStepIndex}
                        totalSteps={totalSteps}
                        onNext={onNext}
                        onPrevious={onPrevious}
                        onDismiss={() => onDismiss('user_clicked_skip')}
                        onButtonClick={onButtonClick}
                    />
                )}
            </div>
        </div>
    )
}
