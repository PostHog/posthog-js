import { h } from 'preact'
import { ProductTourStep, ProductTourAppearance, ProductTourStepButton } from '../../../posthog-product-tours-types'
import { getStepHtml } from '../product-tours-utils'
import { IconPosthogLogo, cancelSVG } from '../../surveys/icons'

export interface ProductTourTooltipInnerProps {
    step: ProductTourStep
    appearance?: ProductTourAppearance
    stepIndex: number
    totalSteps: number
    onNext?: () => void
    onPrevious?: () => void
    onDismiss?: () => void
    onButtonClick?: (button: ProductTourStepButton) => void
}

export function ProductTourTooltipInner({
    step,
    appearance,
    stepIndex,
    totalSteps,
    onNext,
    onPrevious,
    onDismiss,
    onButtonClick,
}: ProductTourTooltipInnerProps): h.JSX.Element {
    const whiteLabel = appearance?.whiteLabel ?? false
    const isLastStep = stepIndex >= totalSteps - 1
    const isFirstStep = stepIndex === 0
    const showDefaultButtons = !step.buttons && (step.progressionTrigger === 'button' || step.type === 'modal')
    const hasCustomButtons = !!step.buttons

    const isInteractive = !!(onNext || onPrevious || onDismiss || onButtonClick)
    const cursorStyle = isInteractive ? undefined : { cursor: 'default' }

    const handleButtonClick = (button: ProductTourStepButton) => {
        if (onButtonClick) {
            onButtonClick(button)
        }
    }

    return (
        <>
            <button class="ph-tour-dismiss" onClick={onDismiss} aria-label="Close tour" style={cursorStyle}>
                {cancelSVG}
            </button>

            <div class="ph-tour-content" dangerouslySetInnerHTML={{ __html: getStepHtml(step) }} />

            <div class="ph-tour-footer">
                {totalSteps > 1 && (
                    <span class="ph-tour-progress">
                        {stepIndex + 1} of {totalSteps}
                    </span>
                )}

                <div class="ph-tour-buttons">
                    {/* Default buttons for tours without custom buttons */}
                    {showDefaultButtons && (
                        <>
                            {!isFirstStep && (
                                <button
                                    class="ph-tour-button ph-tour-button--secondary"
                                    onClick={onPrevious}
                                    style={cursorStyle}
                                >
                                    Back
                                </button>
                            )}
                            <button class="ph-tour-button ph-tour-button--primary" onClick={onNext} style={cursorStyle}>
                                {isLastStep ? 'Done' : 'Next'}
                            </button>
                        </>
                    )}

                    {/* Custom buttons */}
                    {hasCustomButtons && (
                        <>
                            {step.buttons?.secondary && (
                                <button
                                    class="ph-tour-button ph-tour-button--secondary"
                                    onClick={() => handleButtonClick(step.buttons!.secondary!)}
                                    style={cursorStyle}
                                >
                                    {step.buttons.secondary.text}
                                </button>
                            )}
                            {step.buttons?.primary && (
                                <button
                                    class="ph-tour-button ph-tour-button--primary"
                                    onClick={() => handleButtonClick(step.buttons!.primary!)}
                                    style={cursorStyle}
                                >
                                    {step.buttons.primary.text}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {!whiteLabel && (
                <a
                    href={isInteractive ? 'https://posthog.com/product-tours' : undefined}
                    target={isInteractive ? '_blank' : undefined}
                    rel={isInteractive ? 'noopener noreferrer' : undefined}
                    class="ph-tour-branding"
                    style={isInteractive ? undefined : { cursor: 'default', pointerEvents: 'none' }}
                >
                    Tour by {IconPosthogLogo}
                </a>
            )}
        </>
    )
}
