import { h } from 'preact'
import { ProductTourStep, ProductTourAppearance } from '../../../posthog-product-tours-types'
import { renderTipTapContent } from '../product-tours-utils'
import { IconPosthogLogo, cancelSVG } from '../../surveys/icons'

export interface ProductTourTooltipInnerProps {
    step: ProductTourStep
    appearance?: ProductTourAppearance
    stepIndex: number
    totalSteps: number
    onNext?: () => void
    onPrevious?: () => void
    onDismiss?: () => void
}

export function ProductTourTooltipInner({
    step,
    appearance,
    stepIndex,
    totalSteps,
    onNext,
    onPrevious,
    onDismiss,
}: ProductTourTooltipInnerProps): h.JSX.Element {
    const whiteLabel = appearance?.whiteLabel ?? false
    const isLastStep = stepIndex >= totalSteps - 1
    const isFirstStep = stepIndex === 0
    const showNextButton = step.progressionTrigger === 'button' || step.type === 'modal'

    const isInteractive = !!(onNext || onPrevious || onDismiss)
    const cursorStyle = isInteractive ? undefined : { cursor: 'default' }

    return (
        <>
            <button class="ph-tour-dismiss" onClick={onDismiss} aria-label="Close tour" style={cursorStyle}>
                {cancelSVG}
            </button>

            <div class="ph-tour-content" dangerouslySetInnerHTML={{ __html: renderTipTapContent(step.content) }} />

            <div class="ph-tour-footer">
                <span class="ph-tour-progress">
                    {stepIndex + 1} of {totalSteps}
                </span>

                <div class="ph-tour-buttons">
                    {!isFirstStep && (
                        <button
                            class="ph-tour-button ph-tour-button--secondary"
                            onClick={onPrevious}
                            style={cursorStyle}
                        >
                            Back
                        </button>
                    )}
                    {showNextButton && (
                        <button class="ph-tour-button ph-tour-button--primary" onClick={onNext} style={cursorStyle}>
                            {isLastStep ? 'Done' : 'Next'}
                        </button>
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
