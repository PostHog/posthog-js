import { h } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import {
    ProductTour,
    ProductTourStep,
    ProductTourDismissReason,
    ProductTourStepButton,
} from '../../../posthog-product-tours-types'
import { SurveyPosition } from '@posthog/core'
import { calculateTooltipPosition, getSpotlightStyle, TooltipPosition } from '../product-tours-utils'
import { getPopoverPosition } from '../../surveys/surveys-extension-utils'
import { addEventListener } from '../../../utils'
import { window as _window } from '../../../utils/globals'
import { ProductTourTooltipInner } from './ProductTourTooltipInner'
import { ProductTourSurveyStepInner } from './ProductTourSurveyStepInner'
import { isNull } from '@posthog/core'

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
    const [position, setPosition] = useState<ReturnType<typeof calculateTooltipPosition> | null>(null)
    const [spotlightStyle, setSpotlightStyle] = useState<ReturnType<typeof getSpotlightStyle> | null>(null)

    const [displayedStep, setDisplayedStep] = useState(step)
    const [displayedStepIndex, setDisplayedStepIndex] = useState(stepIndex)

    const previousStepRef = useRef(stepIndex)
    const isTransitioningRef = useRef(false)

    // Modal and survey steps use screen positioning (not anchored to an element)
    const isScreenPositioned = displayedStep.type === 'modal' || displayedStep.type === 'survey'

    const updatePosition = useCallback(() => {
        if (!targetElement) return
        const rect = targetElement.getBoundingClientRect()
        setPosition(calculateTooltipPosition(rect))
        setSpotlightStyle(getSpotlightStyle(rect))
    }, [targetElement])

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
            if (targetElement && step.type === 'element') {
                scrollToElement(targetElement, () => {
                    if (previousStepRef.current !== currentStepIndex) return
                    updatePosition()
                    setTimeout(finishEntering, 50)
                })
            } else {
                setTimeout(finishEntering, 50)
            }
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
        if (targetElement) {
            targetElement.click()
        }
        onNext()
    }

    const isVisible = transitionState === 'visible'
    const isSurvey = displayedStep.type === 'survey'

    // For element steps, don't render until position is calculated
    const isPositionReady = isScreenPositioned || !isNull(position)

    const basePosition = { top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', transform: 'none' }

    // surveys default to bottom: 0, and PT should not, so this is a little clunky
    const getModalPosition = () => {
        const pos = getPopoverPosition(undefined, displayedStep.modalPosition ?? SurveyPosition.MiddleCenter)
        if (!('top' in pos) && !('bottom' in pos)) {
            return { ...pos, bottom: '30px' }
        }
        return pos
    }

    const tooltipStyle = {
        ...(displayedStep.maxWidth && {
            width: `${displayedStep.maxWidth}px`,
            maxWidth: `${displayedStep.maxWidth}px`,
        }),
        ...(isScreenPositioned
            ? {
                  ...basePosition,
                  ...getModalPosition(),
              }
            : {
                  top: position ? `${position.top}px` : '0',
                  left: position ? `${position.left}px` : '0',
              }),
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
                class={`ph-tour-tooltip ${isScreenPositioned ? 'ph-tour-tooltip--modal' : ''} ${isSurvey ? 'ph-tour-survey-step' : ''}`}
                style={{
                    ...tooltipStyle,
                    opacity: isVisible && isPositionReady ? 1 : 0,
                    transition: `opacity ${TRANSITION_DURATION}ms ease-out`,
                }}
                onClick={handleTooltipClick}
            >
                {!isScreenPositioned && position && (
                    <div class={`ph-tour-arrow ph-tour-arrow--${getOppositePosition(position.position)}`} />
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
