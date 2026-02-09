import { h } from 'preact'
import { ProductTourStep, ProductTourAppearance, ProductTourStepButton } from '../../../posthog-product-tours-types'
import { getStepHtml, hasElementTarget } from '../product-tours-utils'
import { IconPosthogLogo, cancelSVG } from '../../surveys/icons'

interface TourButtonProps {
    button: ProductTourStepButton
    variant: 'primary' | 'secondary'
    onClick: (button: ProductTourStepButton) => void
    cursorStyle?: h.JSX.CSSProperties
}

function TourButton({ button, variant, onClick, cursorStyle }: TourButtonProps): h.JSX.Element {
    const className = `ph-tour-button ph-tour-button--${variant}`

    if (button.action === 'link' && button.link) {
        return (
            <a
                href={button.link}
                target="_blank"
                rel="noopener noreferrer"
                class={className}
                onClick={() => onClick(button)} // track interaction & dismiss tour
            >
                {button.text}
            </a>
        )
    }

    return (
        <button class={className} onClick={() => onClick(button)} style={cursorStyle}>
            {button.text}
        </button>
    )
}

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
    const showDefaultButtons = !step.buttons && (step.progressionTrigger === 'button' || !hasElementTarget(step))
    const hasCustomButtons = !!step.buttons

    const isInteractive = !!(onNext || onPrevious || onDismiss || onButtonClick)
    const cursorStyle = isInteractive ? undefined : { cursor: 'default' }

    const showPostHogBranding = !whiteLabel && isFirstStep

    const handleButtonClick = (button: ProductTourStepButton) => {
        if (onButtonClick) {
            onButtonClick(button)
        }
    }

    return (
        <>
            <button class="ph-tour-dismiss" onClick={onDismiss} aria-label="Close tour" style={cursorStyle}>
                {cancelSVG()}
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
                                <TourButton
                                    button={step.buttons.secondary}
                                    variant="secondary"
                                    onClick={handleButtonClick}
                                    cursorStyle={cursorStyle}
                                />
                            )}
                            {step.buttons?.primary && (
                                <TourButton
                                    button={step.buttons.primary}
                                    variant="primary"
                                    onClick={handleButtonClick}
                                    cursorStyle={cursorStyle}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

            {showPostHogBranding && (
                <a
                    href={isInteractive ? 'https://posthog.com/docs/product-tours' : undefined}
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
