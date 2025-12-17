import { h } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { ProductTour, ProductTourStep, ProductTourDismissReason } from '../../../posthog-product-tours-types'
import {
    calculateTooltipPosition,
    getSpotlightStyle,
    mergeAppearance,
    renderTipTapContent,
    TooltipPosition,
} from '../product-tours-utils'
import { addEventListener } from '../../../utils'
import { window as _window } from '../../../utils/globals'
import { IconPosthogLogo, cancelSVG } from '../../surveys/icons'

const window = _window as Window & typeof globalThis

type TransitionState = 'initializing' | 'entering' | 'visible' | 'exiting'

export interface ProductTourTooltipProps {
    tour: ProductTour
    step: ProductTourStep
    stepIndex: number
    totalSteps: number
    targetElement: HTMLElement | null
    onNext: () => void
    onPrevious: () => void
    onDismiss: (reason: ProductTourDismissReason) => void
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

export function ProductTourTooltip({
    tour,
    step,
    stepIndex,
    totalSteps,
    targetElement,
    onNext,
    onPrevious,
    onDismiss,
}: ProductTourTooltipProps): h.JSX.Element {
    const appearance = mergeAppearance(tour.appearance)
    const [transitionState, setTransitionState] = useState<TransitionState>('initializing')
    const [position, setPosition] = useState<ReturnType<typeof calculateTooltipPosition> | null>(null)
    const [spotlightStyle, setSpotlightStyle] = useState<ReturnType<typeof getSpotlightStyle> | null>(null)

    const [displayedStep, setDisplayedStep] = useState(step)
    const [displayedStepIndex, setDisplayedStepIndex] = useState(stepIndex)

    const previousStepRef = useRef(stepIndex)
    const isTransitioningRef = useRef(false)
    const isFirstRender = useRef(true)

    const isModalStep = !targetElement

    const updatePosition = useCallback(() => {
        if (isModalStep) {
            return
        }
        const rect = targetElement.getBoundingClientRect()
        setPosition(calculateTooltipPosition(rect))
        setSpotlightStyle(getSpotlightStyle(rect))
    }, [targetElement, isModalStep])

    useEffect(() => {
        const isStepChange = previousStepRef.current !== stepIndex

        const currentStepIndex = stepIndex

        if (isFirstRender.current) {
            isFirstRender.current = false
            previousStepRef.current = stepIndex
            isTransitioningRef.current = true

            if (isModalStep) {
                // Modal steps are just centered on screen - no positioning needed
                setTransitionState('visible')
                isTransitioningRef.current = false
                return
            }

            scrollToElement(targetElement, () => {
                if (previousStepRef.current !== currentStepIndex) {
                    return
                }

                const rect = targetElement.getBoundingClientRect()
                setPosition(calculateTooltipPosition(rect))
                setSpotlightStyle(getSpotlightStyle(rect))
                setTransitionState('visible')
                isTransitioningRef.current = false
            })
            return
        }

        if (isStepChange) {
            previousStepRef.current = stepIndex
            isTransitioningRef.current = true

            setTransitionState('exiting')

            setTimeout(() => {
                if (previousStepRef.current !== currentStepIndex) {
                    return
                }

                setDisplayedStep(step)
                setDisplayedStepIndex(stepIndex)
                setTransitionState('entering')

                if (isModalStep) {
                    // Modal steps don't need scrolling or position calculation
                    setTimeout(() => {
                        if (previousStepRef.current !== currentStepIndex) {
                            return
                        }
                        setTransitionState('visible')
                        isTransitioningRef.current = false
                    }, 50)
                    return
                }

                scrollToElement(targetElement, () => {
                    if (previousStepRef.current !== currentStepIndex) {
                        return
                    }

                    updatePosition()
                    setTimeout(() => {
                        if (previousStepRef.current !== currentStepIndex) {
                            return
                        }
                        setTransitionState('visible')
                        isTransitioningRef.current = false
                    }, 50)
                })
            }, 150)
        }
    }, [targetElement, stepIndex, step, updatePosition, isModalStep])

    useEffect(() => {
        if (transitionState !== 'visible' || isModalStep) {
            return
        }

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
    }, [updatePosition, transitionState, isModalStep])

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

    const isLastStep = displayedStepIndex >= totalSteps - 1
    const isFirstStep = displayedStepIndex === 0

    const containerStyle = {
        '--ph-tour-background-color': appearance.backgroundColor,
        '--ph-tour-text-color': appearance.textColor,
        '--ph-tour-button-color': appearance.buttonColor,
        '--ph-tour-button-text-color': appearance.buttonTextColor,
        '--ph-tour-border-radius': `${appearance.borderRadius}px`,
        '--ph-tour-border-color': appearance.borderColor,
    } as h.JSX.CSSProperties

    const isReady = isModalStep || (transitionState !== 'initializing' && position && spotlightStyle)
    const isVisible = transitionState === 'visible'

    if (!isReady) {
        return (
            <div class="ph-tour-container" style={containerStyle}>
                <div class="ph-tour-click-overlay" onClick={handleOverlayClick} />
                <div class="ph-tour-spotlight" style={{ top: '50%', left: '50%', width: '0px', height: '0px' }} />
            </div>
        )
    }

    // Modal step: centered on screen with overlay dimming, no spotlight/arrow
    if (isModalStep) {
        return (
            <div class="ph-tour-container" style={containerStyle}>
                <div class="ph-tour-click-overlay" onClick={handleOverlayClick} />
                <div class="ph-tour-modal-overlay" />
                <div class="ph-tour-tooltip ph-tour-tooltip--modal" onClick={handleTooltipClick}>
                    <button
                        class="ph-tour-dismiss"
                        onClick={() => onDismiss('user_clicked_skip')}
                        aria-label="Close tour"
                    >
                        {cancelSVG}
                    </button>

                    <div
                        class="ph-tour-content"
                        dangerouslySetInnerHTML={{ __html: renderTipTapContent(displayedStep.content) }}
                    />

                    <div class="ph-tour-footer">
                        <span class="ph-tour-progress">
                            {displayedStepIndex + 1} of {totalSteps}
                        </span>

                        <div class="ph-tour-buttons">
                            {!isFirstStep && (
                                <button class="ph-tour-button ph-tour-button--secondary" onClick={onPrevious}>
                                    Back
                                </button>
                            )}
                            {/* modal steps cannot have action triggers, so we always show the next/done button */}
                            <button class="ph-tour-button ph-tour-button--primary" onClick={onNext}>
                                {isLastStep ? 'Done' : 'Next'}
                            </button>
                        </div>
                    </div>

                    {!appearance.whiteLabel && (
                        <a
                            href="https://posthog.com/product-tours"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="ph-tour-branding"
                        >
                            Tour by {IconPosthogLogo}
                        </a>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div class="ph-tour-container" style={containerStyle}>
            <div class="ph-tour-click-overlay" onClick={handleOverlayClick} />

            <div
                class="ph-tour-spotlight"
                style={{
                    ...(isVisible && spotlightStyle
                        ? spotlightStyle
                        : {
                              top: '50%',
                              left: '50%',
                              width: '0px',
                              height: '0px',
                          }),
                    ...(displayedStep.progressionTrigger === 'click' && {
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                    }),
                }}
                onClick={displayedStep.progressionTrigger === 'click' ? handleSpotlightClick : undefined}
            />

            <div
                class={`ph-tour-tooltip ${isVisible ? 'ph-tour-tooltip--visible' : 'ph-tour-tooltip--hidden'}`}
                style={{
                    top: `${position!.top}px`,
                    left: `${position!.left}px`,
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
                    transition: 'opacity 0.15s ease-out, transform 0.15s ease-out',
                }}
                onClick={handleTooltipClick}
            >
                <div class={`ph-tour-arrow ph-tour-arrow--${getOppositePosition(position!.position)}`} />

                <button class="ph-tour-dismiss" onClick={() => onDismiss('user_clicked_skip')} aria-label="Close tour">
                    {cancelSVG}
                </button>

                <div
                    class="ph-tour-content"
                    dangerouslySetInnerHTML={{ __html: renderTipTapContent(displayedStep.content) }}
                />

                <div class="ph-tour-footer">
                    <span class="ph-tour-progress">
                        {displayedStepIndex + 1} of {totalSteps}
                    </span>

                    <div class="ph-tour-buttons">
                        {!isFirstStep && (
                            <button class="ph-tour-button ph-tour-button--secondary" onClick={onPrevious}>
                                Back
                            </button>
                        )}
                        {displayedStep.progressionTrigger === 'button' && (
                            <button class="ph-tour-button ph-tour-button--primary" onClick={onNext}>
                                {isLastStep ? 'Done' : 'Next'}
                            </button>
                        )}
                    </div>
                </div>

                {!appearance.whiteLabel && (
                    <a
                        href="https://posthog.com/product-tours"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ph-tour-branding"
                    >
                        Tour by {IconPosthogLogo}
                    </a>
                )}
            </div>
        </div>
    )
}
